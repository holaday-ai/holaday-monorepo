/* Test-only kernel: no actual privilege, memfd, close_range, or exec calls. */
#include "../native_api.h"
#include <assert.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static unsigned char data[262144];
static unsigned long used;
static int fds[128], seals, mode, inheritable;
static int failed_op = -1, failed_n = 1, calls[HD_OP_COUNT], result_fd = 3;
static const char *corruption = "";

static void put(unsigned char *p, unsigned long value, int bytes) {
    for (int i = 0; i < bytes; ++i) { p[i] = value & 255; value >>= 8; }
}

long hd_call(enum hd_op op, long a, long b, long c, long d, long e, long f) {
    (void)f;
    assert(op >= 0 && op < HD_OP_COUNT);
    if (++calls[op] == failed_n && (int)op == failed_op) return -1;
    switch (op) {
    case HD_UIDS: case HD_GIDS:
        *(unsigned int *)a = *(unsigned int *)b = *(unsigned int *)c = 0;
        return 0;
    case HD_STATX: {
        assert(a >= 0 && a < 128 && fds[a]);
        assert(strcmp((char *)b, "") == 0 && c == 0x1000 && d == 0x7ff);
        unsigned char *s = (unsigned char *)e;
        put(s, 0x7ff, 4); put(s + 28, a < 3 ? 0010600 : (unsigned long)mode, 2);
        put(s + 40, used, 8);
        if (!strcmp(corruption, "owner")) put(s + 20, 998, 4);
        if (!strcmp(corruption, "stdio_file") && a < 3) put(s + 28, 0100600, 2);
        if (!strcmp(corruption, "size") && a >= 3) put(s + 40, used + 1, 8);
        if (!strcmp(corruption, "mask")) put(s, 0, 4);
        return 0;
    }
    case HD_CLOSE_RANGE:
        assert(b == 4294967295UL && c == 2 && (a == 3 || a == 4));
        for (long i = a; i < 128; ++i) fds[i] = 0;
        return 0;
    case HD_MEMFD:
        assert(!strcmp((char *)a, "holaday-bootstrap-input") && b == 3);
        fds[result_fd] = 1; return result_fd;
    case HD_CHMOD:
        assert(fds[a] && b == 0600); mode = 0100600; return 0;
    case HD_WRITE: {
        assert(fds[a] && !seals && c > 0);
        if (!strcmp(corruption, "zero_write")) return 0;
        long n = c < 31 ? c : 31;
        assert(used + (unsigned long)n <= sizeof(data));
        memcpy(data + used, (void *)b, (size_t)n); used += (unsigned long)n; return n;
    }
    case HD_FCNTL:
        assert(fds[a]);
        if (b == 1033) { assert(c == 15); seals = 15; return 0; }
        if (b == 1034) return !strcmp(corruption, "seals") ? 7 : seals;
        assert(b == 2 && c == 0 && a == 3); inheritable = 1; return 0;
    case HD_DUP3:
        assert(fds[a] && b == 3 && c == 0); fds[3] = 1; inheritable = 1; return 3;
    case HD_CLOSE:
        assert(fds[a]); fds[a] = 0; return 0;
    case HD_EXEC: {
        char **argv = (char **)b, **env = (char **)c;
        assert(!strcmp((char *)a, "/usr/bin/python3"));
        assert(!strcmp(argv[0], "/usr/bin/python3") && !strcmp(argv[1], "-I") && !strcmp(argv[2], "-S"));
        assert(!strcmp(argv[3], "/usr/local/lib/holaday-pool-broker/releases/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/bootstrap.py"));
        assert(argv[4] == NULL && env[2] == NULL);
        assert(!strcmp(env[0], "PATH=/usr/bin:/bin") && !strcmp(env[1], "LANG=C.UTF-8"));
        assert(seals == 15 && inheritable);
        for (int i = 0; i < 128; ++i) assert(fds[i] == (i < 4));
        assert(fwrite(data, 1, used, stdout) == used);
        exit(0);
    }
    case HD_EXIT: exit((int)a);
    default: abort();
    }
}

int main(int argc, char **argv, char **envp) {
    unsigned long stack[1030];
    stack[0] = (unsigned long)argc; stack[1] = (unsigned long)argv[0]; stack[2] = 0;
    unsigned long i = 0;
    for (; envp[i] && i < 1026; ++i) stack[3 + i] = (unsigned long)envp[i];
    stack[3 + i] = 0;
    const char *failure = getenv("HD_TEST_FAILURE");
    if (failure) assert(sscanf(failure, "%d:%d", &failed_op, &failed_n) == 2);
    const char *fd = getenv("HD_TEST_FD");
    if (fd) { result_fd = atoi(fd); assert(result_fd >= 3 && result_fd < 128); }
    const char *bad = getenv("HD_TEST_CORRUPT");
    if (bad) corruption = bad;
    fds[0] = fds[1] = fds[2] = fds[3] = fds[99] = 1;
    hd_start(stack);
    return 112;
}
