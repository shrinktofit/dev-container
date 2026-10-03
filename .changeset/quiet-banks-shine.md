---
"@bsgames/dev-container-sdk": patch
---

Export the account API provided by the Dev Container runtime; move account implementation and transport protocol out of the public SDK.

Infer SDK types from the runtime implementation and bundle standalone public declarations with tsdown, without private package dependencies.
