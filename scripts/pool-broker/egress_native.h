#ifndef HOLADAY_EGRESS_NATIVE_H
#define HOLADAY_EGRESS_NATIVE_H

/* Fixed semantic operations. No caller-supplied path, chmod mode or close FD. */
enum hd_egress_op {
    HE_IDENTITY, HE_ROOT, HE_RUN, HE_PARENT, HE_LISTENER, HE_BIND,
    HE_LISTEN, HE_LEAF, HE_PROBE, HE_MODE, HE_VERIFY, HE_COUNT
};
enum { HE_ROOT_FD, HE_RUN_FD, HE_PARENT_FD, HE_LISTENER_FD, HE_LEAF_FD, HE_FDS };
struct hd_egress {
    int fds[HE_FDS];
    int attempted, transferred, retired;
    long long started;
};
void hd_egress_init(struct hd_egress *state);
int hd_egress_create(struct hd_egress *state);
int hd_egress_take(struct hd_egress *state);
int hd_egress_close(struct hd_egress *state);
/* Concrete Linux backend or explicit test boundary, never JS parameters. */
long long hd_egress_now(void);
int hd_egress_step(enum hd_egress_op op, const struct hd_egress *state);
int hd_egress_close_fd(int fd);
#endif
