# Claude Code + the same Playwright/Chromium as the e2e runner (keep in step
# with @playwright/test in package-lock.json). Runs as the image's non-root
# user; no Docker CLI, no socket.
FROM mcr.microsoft.com/playwright:v1.63.0-noble
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ripgrep less curl ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && npm install -g @anthropic-ai/claude-code \
 && git config --system --add safe.directory /workspace \
 && mkdir -p /home/pwuser/.claude /etc/claude-code \
 && chown -R pwuser:pwuser /home/pwuser/.claude
# Managed settings: highest precedence, can't be overridden by repo settings.
# Explicit modes: repo files are owner-only (0600/0700) and pwuser must be
# able to read the settings and run the doctor; root still owns both.
COPY --chmod=0644 managed-settings.json /etc/claude-code/managed-settings.json
COPY --chmod=0755 doctor.sh /usr/local/bin/e2e-doctor
USER pwuser
WORKDIR /workspace
ENV CLAUDE_CONFIG_DIR=/home/pwuser/.claude
CMD ["claude"]
