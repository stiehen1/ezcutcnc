#!/bin/bash
curl -L https://github.com/stiehen1/ezcutcnc/archive/refs/heads/main.zip -o r.zip && python3 -c "import zipfile; zipfile.ZipFile('r.zip').extractall('.')" && cp -r ezcutcnc-main/. . && rm -rf ezcutcnc-main r.zip && echo "Update complete!"
