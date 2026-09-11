/* Freestanding first entry: no libc, runtime initialization, or app loading. */
#include "native_api.h"

#ifndef HD_CANDIDATE
#error "A release-bound candidate is required"
#endif

static char candidate[] = HD_CANDIDATE;
static char script[] = "/usr/local/lib/holaday-pool-broker/releases/" HD_CANDIDATE "/bootstrap.py";

static void die(void) {
    hd_call(HD_EXIT, 111, 0, 0, 0, 0, 0);
    for (;;) {} /* exit_group is nonreturning; no fallback even on impossible return */
}

static unsigned long bounded_len(const char *s, unsigned long maximum) {
    unsigned long n = 0;
    while (n < maximum && s[n]) ++n;
    if (n == maximum) die();
    return n;
}

static void root(void) {
    unsigned int ids[3];
    if (hd_call(HD_UIDS, (long)&ids[0], (long)&ids[1], (long)&ids[2], 0, 0, 0) != 0
            || ids[0] || ids[1] || ids[2]) die();
    if (hd_call(HD_GIDS, (long)&ids[0], (long)&ids[1], (long)&ids[2], 0, 0, 0) != 0
            || ids[0] || ids[1] || ids[2]) die();
}

static unsigned long number(const unsigned char *s, unsigned int n) {
    unsigned long value = 0;
    for (unsigned int i = 0; i < n; ++i) value |= (unsigned long)s[i] << (i * 8);
    return value;
}

static void metadata(int fd, int capsule, unsigned long size) {
    /* Linux statx fixed-width UAPI: aligned 256-byte buffer, BASIC_STATS mask. */
    unsigned long storage[32];
    unsigned char *s = (unsigned char *)storage;
    for (unsigned int i = 0; i < 32; ++i) storage[i] = 0;
    if (hd_call(HD_STATX, fd, (long)"", 0x1000, 0x7ff, (long)s, 0) != 0) die();
    if ((number(s, 4) & 0x71f) != 0x71f || number(s + 20, 4) || number(s + 24, 4)) die();
    unsigned long mode = number(s + 28, 2);
    if (capsule) {
        if (mode != 0100600 || number(s + 16, 4) != 0 || number(s + 40, 8) != size) die();
    } else if ((mode & 0170000) != 0010000 && (mode & 0170000) != 0140000) die();
}

static void write_all(int fd, const char *s, unsigned long length) {
    while (length) {
        long n = hd_call(HD_WRITE, fd, (long)s, (long)length, 0, 0, 0);
        if (n <= 0 || (unsigned long)n > length) die();
        s += n;
        length -= (unsigned long)n;
    }
}

void hd_start(unsigned long *stack) {
    root();
    if (stack[0] != 1 || !stack[1] || stack[2]) die();
    if (sizeof(candidate) != 41) die();
    int nonzero = 0;
    for (unsigned int i = 0; i < 40; ++i) {
        char c = candidate[i];
        if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) die();
        nonzero |= c != '0';
    }
    if (!nonzero) die();
    char **envp = (char **)(stack + 3);
    unsigned long lengths[1024], count = 0, total = 45;
    while (envp[count]) {
        if (count == 1024) die();
        unsigned long length = bounded_len(envp[count], 131072) + 1;
        if (total + length > 262144) die();
        lengths[count++] = length;
        total += length;
    }
    if (!count) die();
    for (int fd = 0; fd < 3; ++fd) metadata(fd, 0, 0);
    if (hd_call(HD_CLOSE_RANGE, 3, 4294967295UL, 2, 0, 0, 0) != 0) die();
    long fd = hd_call(HD_MEMFD, (long)"holaday-bootstrap-input", 3, 0, 0, 0, 0);
    if (fd < 3 || fd > 2147483647) die();
    if (hd_call(HD_CHMOD, fd, 0600, 0, 0, 0, 0) != 0) die();
    write_all((int)fd, "HPR1", 4);
    write_all((int)fd, candidate, 40);
    for (unsigned long i = 0; i < count; ++i) write_all((int)fd, envp[i], lengths[i]);
    write_all((int)fd, "", 1);
    if (hd_call(HD_FCNTL, fd, 1033, 15, 0, 0, 0) != 0) die();
    long seals = hd_call(HD_FCNTL, fd, 1034, 0, 0, 0, 0);
    if (seals < 0 || (seals & 15) != 15) die();
    metadata((int)fd, 1, total);
    if (fd != 3) {
        if (hd_call(HD_DUP3, fd, 3, 0, 0, 0, 0) != 3) die();
        if (hd_call(HD_CLOSE, fd, 0, 0, 0, 0, 0) != 0) die();
    } else if (hd_call(HD_FCNTL, 3, 2, 0, 0, 0, 0) != 0) die();
    if (hd_call(HD_CLOSE_RANGE, 4, 4294967295UL, 2, 0, 0, 0) != 0) die();
    char *args[] = {"/usr/bin/python3", "-I", "-S", script, (char *)0};
    char *minimal[] = {"PATH=/usr/bin:/bin", "LANG=C.UTF-8", (char *)0};
    root();
    hd_call(HD_EXEC, (long)args[0], (long)args, (long)minimal, 0, 0, 0);
    die();
}
