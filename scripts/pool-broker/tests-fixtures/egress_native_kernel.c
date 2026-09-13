/* Synthetic Linux boundaries. Actual ownership and deadline C is not mocked. */
#include "../egress_native.h"
#include <assert.h>

static long long now;
static int fail_op, late_op, calls, closes, live[64], nextfd;
static int close_failure, late_close, backwards;

long long hd_egress_now(void) { return backwards && calls > 1 ? -1 : now; }
int hd_egress_close_fd(int fd) {
    assert(fd >= 10 && fd < 64 && live[fd]);
    live[fd] = 0;
    ++closes;
    if (late_close == closes) now += 5000;
    return close_failure == closes ? -1 : 0;
}
int hd_egress_step(enum hd_egress_op op, const struct hd_egress *s) {
    assert((int)op == calls++);
    if (op >= HE_RUN) assert(s->fds[HE_ROOT_FD] >= 10);
    if (op >= HE_PARENT) assert(s->fds[HE_RUN_FD] >= 10);
    if (op >= HE_BIND) assert(s->fds[HE_PARENT_FD] >= 10 && s->fds[HE_LISTENER_FD] >= 10);
    if (op >= HE_PROBE) assert(s->fds[HE_LEAF_FD] >= 10);
    if (fail_op == (int)op) return -1;
    if (late_op == (int)op) now += 5000;
    if (op == HE_ROOT || op == HE_RUN || op == HE_PARENT || op == HE_LISTENER || op == HE_LEAF) {
        live[nextfd] = 1;
        return nextfd++;
    }
    return 0;
}
static void reset(void) {
    now = calls = closes = close_failure = late_close = backwards = 0;
    fail_op = late_op = -1;
    nextfd = 10;
    for (int i = 0; i < 64; ++i) assert(!live[i]);
}
static void none(void) { for (int i = 0; i < 64; ++i) assert(!live[i]); }
static void rejected(struct hd_egress *s) {
    assert(hd_egress_create(s) == -1);
    none();
    assert(hd_egress_take(s) == -1);
    int before = calls;
    assert(hd_egress_create(s) == -1 && calls == before);
    assert(hd_egress_close(s) == 0);
}
int main(void) {
    struct hd_egress s;
    for (int op = 0; op < HE_COUNT; ++op) {
        reset(); hd_egress_init(&s); fail_op = op; rejected(&s);
        reset(); hd_egress_init(&s); late_op = op; rejected(&s);
    }
    for (int i = 1; i <= 4; ++i) {
        reset(); hd_egress_init(&s); close_failure = i; rejected(&s);
        reset(); hd_egress_init(&s); late_close = i; rejected(&s);
    }
    reset(); hd_egress_init(&s); backwards = 1; rejected(&s);
    reset(); hd_egress_init(&s);
    assert(hd_egress_take(&s) == -1);
    assert(hd_egress_create(&s) == 0 && closes == 4 && live[13]);
    assert(hd_egress_create(&s) == -1);
    int fd = hd_egress_take(&s);
    assert(fd == 13 && hd_egress_take(&s) == -1);
    assert(hd_egress_close(&s) == 0 && live[fd] && closes == 4);
    /* Pretend Node closed and OS reused its integer: native must not touch it. */
    live[fd] = 0; live[fd] = 1;
    assert(hd_egress_close(&s) == 0 && live[fd]);
    live[fd] = 0;
    reset(); hd_egress_init(&s);
    assert(hd_egress_create(&s) == 0 && hd_egress_close(&s) == 0);
    none(); assert(hd_egress_take(&s) == -1);
    return 0;
}
