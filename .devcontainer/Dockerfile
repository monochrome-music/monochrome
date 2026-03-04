# ------------------------------------------------------------
# Base Image
# ------------------------------------------------------------
FROM debian:unstable-slim

ENV DEBIAN_FRONTEND=noninteractive
ENV LANG=C.UTF-8
ENV LC_ALL=C.UTF-8

# ------------------------------------------------------------
# System Dependencies
# ------------------------------------------------------------
RUN apt-get update && apt-get upgrade -y && \
    apt-get install -y --no-install-recommends \
        curl \
        ca-certificates \
        git \
        build-essential \
        sudo \
        fish \
        unzip \
        xz-utils \
        libatomic1 \
        libc6 \
        wget && \
    rm -rf /var/lib/apt/lists/*

# ------------------------------------------------------------
# Create Non-Root User
# ------------------------------------------------------------
ARG USERNAME=devuser
ARG UID=1000
ARG GID=1000

RUN groupadd --gid ${GID} ${USERNAME} && \
    useradd --uid ${UID} --gid ${GID} -m -s /usr/bin/fish ${USERNAME} && \
    echo "${USERNAME} ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers

USER ${USERNAME}
WORKDIR /home/${USERNAME}

# ------------------------------------------------------------
# Install Bun (Non-Root)
# ------------------------------------------------------------
ENV BUN_INSTALL=/home/${USERNAME}/.bun
ENV PATH="${BUN_INSTALL}/bin:${PATH}"

RUN curl -fsSL https://bun.sh/install | bash

# ------------------------------------------------------------
# Install OpenCode (Proper PATH Handling)
# ------------------------------------------------------------
RUN curl -fsSL https://opencode.ai/install -o opencode-install && \
    chmod +x opencode-install && \
    ./opencode-install --yes && \
    rm opencode-install

# Add OpenCode to PATH permanently
ENV PATH="/home/${USERNAME}/.opencode/bin:${PATH}"
    
# ------------------------------------------------------------
# Ensure fish is Default Shell
# ------------------------------------------------------------
ENV SHELL=/usr/bin/fish

CMD ["fish"]