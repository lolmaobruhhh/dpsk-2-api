FROM node:20-slim

# Prevent Playwright from downloading its own bundled Chromium (~400MB) — we use the system Chrome instead!
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    PLAYWRIGHT_BROWSERS_PATH=0

# Install necessary graphical dependencies, xvfb, x11vnc, novnc, window manager, Chrome, and GIT
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    ca-certificates \
    xvfb \
    x11vnc \
    fluxbox \
    novnc \
    websockify \
    dos2unix \
    curl \
    wget \
    gnupg \
    procps \
    && wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add - \
    && sh -c 'echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google.list' \
    && apt-get update && apt-get install -y --no-install-recommends google-chrome-stable \
    && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

# Fix noVNC launch script paths
RUN ln -s /usr/share/novnc/vnc_auto.html /usr/share/novnc/index.html || true

# Setup a non-root user (Hugging Face Spaces requirement)
USER node
ENV HOME=/home/node \
    PATH=/home/node/.local/bin:$PATH

WORKDIR $HOME/app

# Bypass Hugging Face global cache by polling the latest commit. 
# Whenever you push a new commit, this layer invalidates automatically!
ADD "https://api.github.com/repos/lolmaobruhhh/dpsk-2-api/commits?per_page=1" /tmp/latest_commit

# Clone your specific repository directly into the container
RUN git clone https://github.com/lolmaobruhhh/dpsk-2-api.git .

# Install dependencies (Playwright will NOT download Chromium thanks to env vars above)
RUN npm install --omit=dev

# Fix Windows CRLF line endings on the shell script so bash doesn't crash on boot
RUN dos2unix start.sh

# Expose ONLY 7860, which Hugging Face expects
EXPOSE 7860

# Give permissions to the start script and run it
RUN chmod +x start.sh
CMD ["./start.sh"]
