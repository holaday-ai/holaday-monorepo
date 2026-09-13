#include "egress_native.h"

void hd_egress_init(struct hd_egress *s) {
    for (int i = 0; i < HE_FDS; ++i) s->fds[i] = -1;
    s->attempted = s->transferred = s->retired = 0;
    s->started = -1;
}

static int budget(const struct hd_egress *s) {
    long long now = hd_egress_now();
    return now >= s->started && s->started >= 0 && now - s->started < 5000;
}

int hd_egress_close(struct hd_egress *s) {
    int failed = 0;
    s->retired = 1;
    for (int i = HE_FDS - 1; i >= 0; --i) {
        int fd = s->fds[i];
        s->fds[i] = -1; /* Never retry Linux close after EINTR or a reused FD. */
        if (fd >= 0 && hd_egress_close_fd(fd) != 0) failed = 1;
    }
    return failed ? -1 : 0;
}

int hd_egress_create(struct hd_egress *s) {
    if (s->attempted || s->retired || s->transferred) return -1;
    s->attempted = 1;
    s->started = hd_egress_now();
    for (int op = 0; op < HE_COUNT; ++op) {
        if (!budget(s)) goto failed;
        int value = hd_egress_step((enum hd_egress_op)op, s);
        if (value < 0) goto failed;
        int slot = -1;
        switch (op) {
            case HE_ROOT: slot = HE_ROOT_FD; break;
            case HE_RUN: slot = HE_RUN_FD; break;
            case HE_PARENT: slot = HE_PARENT_FD; break;
            case HE_LISTENER: slot = HE_LISTENER_FD; break;
            case HE_LEAF: slot = HE_LEAF_FD; break;
            default: break;
        }
        /* Own the returned FD BEFORE the post-operation deadline check. */
        if (slot >= 0) s->fds[slot] = value;
        if (!budget(s)) goto failed;
    }
    for (int i = HE_FDS - 1; i >= 0; --i) {
        if (i == HE_LISTENER_FD) continue;
        int fd = s->fds[i];
        s->fds[i] = -1;
        if (hd_egress_close_fd(fd) != 0) goto failed;
        if (!budget(s)) goto failed;
    }
    return 0;
failed:
    hd_egress_close(s);
    return -1;
}

int hd_egress_take(struct hd_egress *s) {
    if (!s->attempted || s->retired || s->transferred || s->fds[HE_LISTENER_FD] < 0) return -1;
    s->transferred = 1;
    int fd = s->fds[HE_LISTENER_FD];
    s->fds[HE_LISTENER_FD] = -1; /* Irrevocable BEFORE publishing the integer. */
    return fd;
}
