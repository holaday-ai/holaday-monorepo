FROM holaday-first-cutover-task3:qa
RUN apt-get update && apt-get install -y --no-install-recommends age
# Build with network, then run tests with --network none and read-only source.
