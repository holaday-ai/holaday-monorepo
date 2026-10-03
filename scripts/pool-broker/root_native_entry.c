/* Root service first exec: no libc, application environment, or runtime options. */
#include "native_api.h"

#ifndef HD_CANDIDATE
#error "A release-bound candidate is required"
#endif

static char candidate[] = HD_CANDIDATE;
static char script[] = "/usr/local/lib/holaday-pool-broker/releases/" HD_CANDIDATE "/bootstrap.py";

static void die(void) {
    hd_call(HD_EXIT, 111, 0, 0, 0, 0, 0);
    for (;;) {}
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

static void stdio(int fd) {
    unsigned long storage[32];
    unsigned char *s = (unsigned char *)storage;
    for (unsigned int i = 0; i < 32; ++i) storage[i] = 0;
    if (hd_call(HD_STATX, fd, (long)"", 0x1000, 0x7ff, (long)s, 0) != 0) die();
    if ((number(s, 4) & 0x71f) != 0x71f || number(s + 20, 4) || number(s + 24, 4)) die();
    unsigned long mode = number(s + 28, 2) & 0170000;
    if (mode != 0010000 && mode != 0140000) die();
}

void hd_start(unsigned long *stack) {
    root();
    if (stack[0] != 1 || !stack[1] || stack[2] || sizeof(candidate) != 41) die();
    int nonzero = 0;
    for (unsigned int i = 0; i < 40; ++i) {
        char c = candidate[i];
        if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) die();
        nonzero |= c != '0';
    }
    if (!nonzero) die();
    for (int fd = 0; fd < 3; ++fd) stdio(fd);
    if (hd_call(HD_CLOSE_RANGE, 3, 4294967295UL, 2, 0, 0, 0) != 0) die();
    char *args[] = {"/usr/bin/python3", "-I", "-S", script, "--root-broker", (char *)0};
    char *minimal[] = {"PATH=/usr/bin:/bin", "LANG=C.UTF-8", (char *)0};
    root();
    hd_call(HD_EXEC, (long)args[0], (long)args, (long)minimal, 0, 0, 0);
    die();
}
