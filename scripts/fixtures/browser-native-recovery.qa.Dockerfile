# Disposable arm64 QA only; never build or install on a production host.
# The runner verifies the inherited Node22.20/PM2 6.0.14 image identity.
ARG NATIVE_BASE_IMAGE=ubuntu:22.04
FROM holaday-first-cutover-network:qa AS tools
FROM ${NATIVE_BASE_IMAGE}
ENV DEBIAN_FRONTEND=noninteractive
COPY --from=tools /opt/node22 /opt/node22
ENV PATH=/opt/node22/bin:/usr/bin:/bin
ARG BRAVE_VERSION=1.89.141
ARG BRAVE_SHA256=3900af7b046b0190f7e1894a15a4c2d2a9c9849e4b1979f672d755af52ca9b50
RUN sed -i '/^deb /s/ main restricted$/ main restricted universe/' /etc/apt/sources.list \
 && apt-get update && apt-get install -y --no-install-recommends ca-certificates curl python3.10 python3-websockify novnc xvfb x11vnc xauth x11-utils iproute2 util-linux procps lsof psmisc \
 && curl --fail --silent --show-error --location "https://brave-browser-apt-release.s3.brave.com/pool/main/b/brave-browser/brave-browser_${BRAVE_VERSION}_arm64.deb" -o /tmp/brave.deb \
 && printf '%s  /tmp/brave.deb\n' "$BRAVE_SHA256" | sha256sum --check - \
 && curl --fail --silent --show-error --location "https://brave-browser-apt-release.s3.brave.com/pool/main/b/brave-keyring/brave-keyring_1.20-1.deb" -o /tmp/brave-keyring.deb \
 && printf '9ea8725ad4241e4d30bc31b0d5213c7ce24b1dcd5247875b2de1bcba8c4e9b00  /tmp/brave-keyring.deb\n' | sha256sum --check - \
 && apt-get install -y --no-install-recommends /tmp/brave-keyring.deb /tmp/brave.deb \
 && rm /tmp/brave-keyring.deb /tmp/brave.deb && rm -rf /var/lib/apt/lists/* \
 && dpkg-query -W -f='${Package}=${Version}\n' > /opt/qa-native-package-versions.txt \
 && test "$(readlink -f /usr/bin/python3)" = /usr/bin/python3.10 \
 && /usr/bin/python3 -c 'import importlib.metadata as m; assert m.version("websockify")=="0.10.0"' \
 && test "$(/opt/node22/bin/node --version)" = v22.20.0 \
 && mkdir -p /etc/brave/policies/managed /opt/qa-unrelated
RUN printf 'setInterval(()=>{},1000)\n' > /opt/qa-unrelated/main.mjs
# The real source reader and RPC loader use this literal protected package root.
# Copy actual pinned PM2 bytes; do not alias a different loader or interpreter.
COPY --from=tools /opt/node22/lib/node_modules/pm2 /usr/lib/node_modules/pm2
# The approved startup source permits this optional cache to be absent. The QA
# runner bind-mounts its cache directory read-only before any Python/PM2 startup,
# so no interpreter can regenerate a different distro-timestamp cache afterward.
RUN rm /usr/lib/python3.10/__pycache__/sitecustomize.cpython-310.pyc

# Protect the actual pinned Node distribution before the QA daemon starts.
RUN chown -R 0:0 /opt/node22 && chmod go-w /opt/node22 /opt/node22/bin /opt/node22/bin/node
