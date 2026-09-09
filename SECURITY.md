# Security policy

## Deployment boundary

Kobra Bridge is a LAN controller without internet-facing authentication. Run it only on a trusted network or behind an authenticated VPN/reverse proxy. Do not forward its ports from your router.

Treat these as secrets:

- `config/config.ini`
- `.env`
- `certs/anycubic_slicer.key`
- printer-signed upload URLs and MQTT credentials

The repository ignores them. Before sharing logs, verify that credentials and signed URLs are redacted.

## Reporting a vulnerability

Do not open a public issue containing credentials, private keys, printer IP inventories, or customer G-code. Use GitHub's private security-advisory flow for this repository.

## Safety boundary

Cross-model conversion fails closed. Reports that bypass build-volume, nozzle, temperature, chamber, source-model, or multicolour checks are security/safety issues. Do not demonstrate them by starting a real print; use a synthetic fixture and the test suite.
