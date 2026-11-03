# Bambu Lab A1 integration

The A1 uses the existing experimental `bambu-lab` adapter. Select **A1** in Add printer and provide its IP address, serial number and LAN access code with LAN Only/Developer access enabled. Defaults are MQTT TLS 8883, implicit FTPS 990 and TLS/JPEG camera 6000. Printer firmware may restrict third-party LAN commands; verify the enabled access mode on the printer.

The A1 has one physical nozzle, a 100°C maximum bed target and 300°C maximum nozzle target. Chamber temperature/fan/preheat and lidar controls are not exposed. A1 Mini remains a separate model with an 80°C bed limit. See Bambu's [A1 technical specifications](https://bambulab.com/en/a1/tech-specs) and [A1 Combo quick-start guide](https://cdn1.bambulab.com/documentation/quick-start-f507128172bdf/Quick%20start%20guide%20-%20A1%20combo-EN.pdf).

## Materials and print setup

Use the four slots of one AMS Lite or the external spool. The controller reads actual tray presence, material, colour and active source; it does not invent loaded filaments. The shared Bambu Toolheads interface exposes the same filament types, colour families and Set filament actions as other supported Bambu models. Only idle printers and explicitly non-RFID, present AMS slots allow edits; RFID-managed and unknown-tag slots remain read-only. Writes are re-read for verification. AMS Lite-compatible materials are required; standard flexible TPU and PETG-CF are unsuitable for AMS Lite.

Multi-material printing requires a sliced `.3mf`, with file filaments mapped to reported AMS slots. The external spool supports single-material work. Raw single-material `.gcode` starts remain experimental. Automatic scheduling retains the existing live compatibility, nozzle/material/colour, licensing, reservation and bed-clearance checks; adding the model does not bypass them. Slice files for the A1 rather than assuming an A1 Mini or P1/X1 machine profile is interchangeable.

## Simulator and acceptance

The integrated simulator includes **Simulated Bambu Lab A1**, with MQTT 18923, FTPS 20030 and camera 16040 for the first instance. Additional instances get available ports. It models one four-slot AMS Lite or no AMS, plus the external spool. Use the simulator's displayed connection details rather than these ports for a physical printer.

Automated tests exercise the production adapter against simulated TLS MQTT/FTPS and camera endpoints, material edits and protection rules, job controls and the shared browser presentation. This confirms controller behaviour against the simulator model, not physical firmware compatibility.

Before unattended physical use, verify LAN/Developer-mode access, status and reconnects, upload/list/verify/delete, AMS Lite and external-spool selection, two-material `.3mf` mapping, pause/resume/cancel, temperature/fan commands and camera snapshots/streaming. Check RFID/manual/empty tray handling and busy editing rejection on Windows and Kubernetes. Physical A1 validation is pending.

## Bundled model artwork

The dashboard's `public/assets/printers/a1.webp` is a transparent product-identification cutout, resized to the shared 400×190 canvas, from Bambu's [A1 product page](https://uk.store.bambulab.com/products/a1), using the [manufacturer-hosted source image](https://store.bblcdn.eu/f1da182f80474db1b1573dc7c8651454.png). Bambu Lab retains its product artwork and trademarks. The image is bundled locally and does not require browser requests to the manufacturer.
