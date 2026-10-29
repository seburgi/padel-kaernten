---
date: 2026-10-29
area: app
title: Nach einer längeren Pause startet die App ohne Fehler
---
Wer die App länger als eine halbe Stunde nicht offen hatte, sah beim Start
manchmal „Die freien Plätze konnten nicht geladen werden“. Das lag nicht an
der Verbindung, sondern an der Anmeldung, die sich im Hintergrund erneuert.

Jetzt wartet die App kurz, bis die Anmeldung erneuert ist, und fragt dann
noch einmal. Klappt es trotzdem nicht, lädt sie sich einmal neu.
