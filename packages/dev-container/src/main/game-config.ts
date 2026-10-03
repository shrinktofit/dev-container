import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { Ajv } from 'ajv';
import { parse } from 'yaml';
import {
  createLaunchValues,
  LaunchFieldType,
  type GameConfig,
  type LaunchFieldSchema,
  type LaunchSchema,
  type LaunchOverrides,
  type LaunchValue,
} from '@bsgames/dev-container-api/game-config';

const ajv = new Ajv({ allErrors: true, strict: true });
ajv.addKeyword({
  keyword: 'x-default-env',
  schemaType: 'string',
  valid: true,
});
const validateTop = ajv.compile({
  type: 'object',
  required: ['version', 'game'],
  additionalProperties: false,
  properties: {
    version: { const: 1 },
    game: {
      type: 'object',
      required: ['id', 'title'],
      additionalProperties: false,
      properties: {
        id: { type: 'string', pattern: '^[a-zA-Z0-9][a-zA-Z0-9._-]*$' },
        title: { type: 'string', minLength: 1 },
      },
    },
    client: {
      type: 'object',
      additionalProperties: false,
      properties: { dir: { type: 'string' }, subpath: { type: 'string' } },
    },
    launch: {
      type: 'object',
      required: ['schema'],
      additionalProperties: false,
      properties: { schema: { type: 'string', minLength: 1 } },
    },
  },
});
const rootKeywords = new Set([
  '$schema',
  'type',
  'properties',
  'required',
  'additionalProperties',
]);
const fieldKeywords = new Set([
  'type',
  'enum',
  'default',
  'x-default-env',
  'title',
  'description',
  'minimum',
  'maximum',
  'minLength',
  'maxLength',
]);

function readLaunchEnvironment(targetDirectory: string): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const name of ['.env', '.env.local']) {
    const file = join(targetDirectory, name);
    if (existsSync(file)) {
      try {
        Object.assign(environment, parseEnv(readFileSync(file, 'utf8')));
      } catch (error) {
        throw new Error(file + ': ' + String(error), { cause: error });
      }
    }
  }
  return environment;
}

function readEnvironmentDefault(
  field: LaunchFieldSchema,
  name: string,
  environment: Record<string, string>,
  targetDirectory: string,
): LaunchValue {
  const variable = field['x-default-env'];
  if (typeof variable !== 'string' || !variable.trim()) {
    throw new Error(name + '.x-default-env must name a non-empty environment variable.');
  }
  if (Object.hasOwn(field, 'default')) {
    throw new Error(name + ' cannot specify both default and x-default-env (' + variable + ').');
  }
  if (!Object.hasOwn(environment, variable)) {
    throw new Error(
      name
      + ': environment variable '
      + variable
      + ' is not defined in '
      + join(targetDirectory, '.env')
      + ' or '
      + join(targetDirectory, '.env.local')
      + '.',
    );
  }
  const raw = environment[variable];
  if (field.type === LaunchFieldType.string) {
    return raw;
  }
  if (field.type === LaunchFieldType.boolean) {
    if (raw !== 'true' && raw !== 'false') {
      throw new Error(name + ': environment variable ' + variable + ' must be true or false.');
    }
    return raw === 'true';
  }
  const value = Number(raw);
  if (!raw.trim() || !Number.isFinite(value)) {
    throw new Error(name + ': environment variable ' + variable + ' must be a finite number.');
  }
  return value;
}

function readLaunchSchema(
  file: string,
  environment: Record<string, string>,
  targetDirectory: string,
): LaunchSchema {
  try {
    const input: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new Error('Launch schema must be an object.');
    }
    const schema = input as LaunchSchema;
    for (const key of Object.keys(schema)) {
      if (!rootKeywords.has(key)) {
        throw new Error('Unsupported launch schema keyword: ' + key);
      }
    }
    if (
      schema.$schema !== undefined
      && schema.$schema !== 'http://json-schema.org/draft-07/schema#'
    ) {
      throw new Error('Launch schema must use JSON Schema draft-07.');
    }
    if (!ajv.validateSchema(schema)) {
      throw new Error('Invalid launch schema: ' + ajv.errorsText(ajv.errors));
    }
    if (
      schema.type !== 'object'
      || schema.additionalProperties !== false
      || !schema.properties
      || Array.isArray(schema.properties)
    ) {
      throw new Error(
        'Launch schema requires type: object, properties, and additionalProperties: false.',
      );
    }
    for (const [name, field] of Object.entries(schema.properties)) {
      if (!field || typeof field !== 'object' || Array.isArray(field)) {
        throw new Error('Invalid launch field: ' + name);
      }
      for (const key of Object.keys(field)) {
        if (!fieldKeywords.has(key)) {
          throw new Error('Unsupported launch field keyword: ' + name + '.' + key);
        }
      }
      if (!Object.values(LaunchFieldType).includes(field.type)) {
        throw new Error('Unsupported launch field type: ' + name);
      }
      if (Object.hasOwn(field, 'x-default-env')) {
        field.default = readEnvironmentDefault(field, name, environment, targetDirectory);
      }
      const validateField = ajv.compile(field);
      if (field.default !== undefined && !validateField(field.default)) {
        throw new Error(
          'Invalid default for '
          + name
          + (field['x-default-env'] ? ' from environment variable ' + field['x-default-env'] : '')
          + ': '
          + ajv.errorsText(validateField.errors),
        );
      }
    }
    if (schema.required?.some((name) => !Object.hasOwn(schema.properties, name))) {
      throw new Error('Required launch field has no property.');
    }
    ajv.compile(schema);
    return schema;
  } catch (error) {
    throw new Error(file + ': ' + (error instanceof Error ? error.message : String(error)), {
      cause: error,
    });
  }
}

export function loadGameConfig(targetDirectory: string): GameConfig {
  const file = join(targetDirectory, 'dev-container.config.yaml');
  try {
    const input = parse(readFileSync(file, 'utf8'));
    if (!validateTop(input)) {
      throw new Error(ajv.errorsText(validateTop.errors));
    }
    const source = input as {
      version: 1;
      game: GameConfig['game'];
      client?: Partial<GameConfig['client']>;
      launch?: { schema: string };
    };
    const client = { dir: source.client?.dir ?? '.', subpath: source.client?.subpath ?? '' };
    if (
      /[?#\\]/u.test(client.subpath)
      || client.subpath.startsWith('//')
      || /^[a-zA-Z][a-zA-Z0-9+.-]*:/u.test(client.subpath)
    ) {
      throw new Error('client.subpath must be a preview path without a URL, query or fragment.');
    }
    const environment = readLaunchEnvironment(targetDirectory);
    const schema = source.launch
      ? readLaunchSchema(
        resolve(targetDirectory, source.launch.schema),
        environment,
        targetDirectory,
      )
      : {
        type: 'object' as const,
        properties: {},
        additionalProperties: false as const,
      };
    return {
      version: source.version,
      game: source.game,
      client,
      launch: { schema },
    };
  } catch (error) {
    throw new Error(file + ': ' + (error instanceof Error ? error.message : String(error)), {
      cause: error,
    });
  }
}

export function createClientUrl(
  config: GameConfig,
  overrides: LaunchOverrides,
  previewUrl: string,
): string {
  for (const key of Object.keys(overrides)) {
    if (!Object.hasOwn(config.launch.schema.properties, key)) {
      throw new Error(
        'Invalid launch parameters: data must NOT have additional properties: ' + key,
      );
    }
  }
  const values = createLaunchValues(config.launch.schema, overrides);
  const validate = ajv.compile(config.launch.schema);
  if (!validate(values)) {
    throw new Error('Invalid launch parameters: ' + ajv.errorsText(validate.errors));
  }
  const url = new URL(previewUrl);
  for (const name of Object.keys(config.launch.schema.properties)) {
    url.searchParams.delete(name);
    if (values[name] !== undefined) {
      url.searchParams.set(name, String(values[name]));
    }
  }
  return url.href;
}
