# Security policy

Eterna IDE is a single-user local application. It binds to loopback, requires a per-launch bearer token for API access, validates request origins, and keeps credentials in the official tools' authentication stores. Do not expose its port to a network or share launch URLs.

Report vulnerabilities privately to **support@eternaxcode.com** with affected version, reproduction steps using synthetic data, and expected impact. Do not include access tokens, private repositories, or subscription credentials. Only the latest release is currently maintained; this project does not promise a response SLA.

AI source snapshots protect original working files from accidental edits; they are not an OS security sandbox. The official CLI's permissions and the host operating system remain relevant. Local test commands run with the user's privileges.
