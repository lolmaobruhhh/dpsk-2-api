#!/bin/bash
set -e

echo "=== DeepSeek2API Container Boot ==="
echo "Time: $(date)"
echo "Memory: $(free -m 2>/dev/null || echo 'N/A')"
echo "Disk: $(df -h / 2>/dev/null | tail -1 || echo 'N/A')"
echo "Node: $(node --version)"
echo "Chrome: $(google-chrome-stable --version 2>/dev/null || echo 'N/A')"
echo "==================================="

export PORT=7860

# Start the Node server with crash logging
exec node index.js 2>&1
