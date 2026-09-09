# Anycubic TLS client certificate

Kobra Bridge does not redistribute `anycubic_slicer.crt` or `anycubic_slicer.key`. They are third-party interoperability material, not GPL-covered project code; see [../NOTICE.md](../NOTICE.md).

The printer's LAN MQTT broker expects this client identity. Obtain the pair from software or a package you are entitled to use, for example the `anycubic-certs.zip` asset published by the upstream KX-Bridge project:

https://gitea.it-drui.de/viewit/KX-Bridge-Release/releases

Place the files here:

```text
certs/anycubic_slicer.crt
certs/anycubic_slicer.key
```

Docker mounts `./certs` read-only at `/app/certs`. For a direct Python install, either place the files beside `kobrax_client.py` or set:

```sh
export KOBRA_CERT_DIR=/absolute/path/to/certs
```

Never commit, paste into an issue, or publish the private key. Local printer usernames/passwords belong only in `config/config.ini`, which is also gitignored.
