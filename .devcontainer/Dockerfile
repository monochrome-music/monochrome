# ------------------------------------------------------------
# Base Image
# ------------------------------------------------------------
FROM mcr.microsoft.com/devcontainers/base:debian

# ------------------------------------------------------------
# System Dependencies
# ------------------------------------------------------------
RUN apt update && apt upgrade -y && \
    apt-get install -y --no-install-recommends \
        git \
        git-lfs \
        fish \
        nodejs \
        npm \
        curl

# ------------------------------------------------------------
# Install Bun (Non-Root)
# ------------------------------------------------------------
ENV BUN_INSTALL="$HOME/.bun"
ENV PATH="$BUN_INSTALL/bin:$PATH"
    
RUN curl -fsSL https://bun.sh/install | bash

# ------------------------------------------------------------
# Install OpenCode (Proper PATH Handling)
# ------------------------------------------------------------
RUN curl -fsSL https://opencode.ai/install -o opencode-install && \
    chmod +x opencode-install && \
    ./opencode-install --yes && \
    rm opencode-install

# Add OpenCode to PATH permanently
ENV PATH="$HOME/.opencode/bin:$PATH"
    
# ------------------------------------------------------------
# Ensure fish is Default Shell
# ------------------------------------------------------------
ENV SHELL=/usr/bin/fish

CMD ["fish"]