# Dashboard

Password-protected dashboard. The page fetches ciphertext at runtime and decrypts it in the browser with PBKDF2-SHA256 and AES-GCM. The password is not stored. Until unlock, the page shows only the generic heading Dashboard. After unlock, every section is filled only from the decrypted document. A missing ciphertext file shows setup pending and does not decrypt.

The ciphertext request is cache: no-store, credentials omitted, to https://raw.githubusercontent.com/iodiot/dashboard-data/main/data.enc.json.

A wrong password and damaged ciphertext both report: Incorrect password or damaged data. A malformed envelope reports: Encrypted data is malformed.

Published ciphertext can be guessed offline. Replacing the file does not remove older copies held by the host.
