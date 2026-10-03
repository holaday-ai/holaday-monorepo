FROM holaday-first-cutover-network:qa
RUN apt-get update && apt-get install -y --no-install-recommends git age ca-certificates openssh-client && rm -rf /var/lib/apt/lists/*
ENV PATH=/opt/node22/bin:/usr/sbin:/usr/bin:/sbin:/bin
RUN npm install --global pnpm@10.33.0 --ignore-scripts --no-audit --no-fund

# Candidate application runtime is on the original native-loader patched line.
# This does not replace the separately verified legacy/native Node22.20 image.
COPY node-v22.23.2-linux-arm64.tar.xz /tmp/qa-candidate-node.tar.xz
RUN printf 'fff4078c5def658577f92c88db7db3bc0072924bfb93fe52c1e744a54e94abb8  /tmp/qa-candidate-node.tar.xz\n' | sha256sum --check - \
 && tar -xJf /tmp/qa-candidate-node.tar.xz --strip-components=1 -C /opt/node22 \
 && rm /tmp/qa-candidate-node.tar.xz \
 && test "$(/opt/node22/bin/node --version)" = v22.23.2 \
 && chown root:root /opt/node22/bin/node && chmod 0755 /opt/node22/bin/node
