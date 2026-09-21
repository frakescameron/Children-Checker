#!/data/data/com.termux/files/usr/bin/bash
# Auto-starts the check-in server whenever the host tablet boots up.
# This file needs to live at: ~/.termux/boot/start-checkin-server.sh
# (Termux:Boot runs every script in that folder automatically on boot.)

termux-wake-lock

cd ~/kids-checkin || exit 1
node server.js >> ~/kids-checkin/server.log 2>&1
