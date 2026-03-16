#!/bin/bash
curl -L https://github.com/stiehen1/ezcutcnc/archive/refs/heads/main.zip -o r.zip && unzipNLS -o r.zip && cp -r ezcutcnc-main/. . && rm -rf ezcutcnc-main r.zip && echo "Update complete!"
