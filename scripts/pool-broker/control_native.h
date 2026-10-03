#ifndef HOLADAY_CONTROL_NATIVE_H
#define HOLADAY_CONTROL_NATIVE_H
#include <stddef.h>
#include <stdint.h>

enum { HC_ROOT, HC_RUN, HC_PARENT, HC_LEAF, HC_SOCKET, HC_PIN, HC_FDS };
struct hd_control {
    int fds[HC_FDS];
    int attempted, connected, retired, cleanup_failed, eof, write_ended;
    int connecting, publication;
    int app_pid, root_pid;
    long long started, last;
    /* Optional earlier absolute CLOCK_MONOTONIC millisecond bound. */
    long long scope_deadline;
    size_t received, sent;
    uint64_t socket_device, socket_inode;
};
void hd_control_init(struct hd_control *s);
int hd_control_open(struct hd_control *s);
/* 1 connected, 0 pending without business IO, -1 terminal failure. */
int hd_control_ready(struct hd_control *s);
int hd_control_check(struct hd_control *s);
/* read: >=0 bytes, -2 would-block, -1 permanent failure. 0 is actual EOF. */
int hd_control_read(struct hd_control *s, unsigned char out[4100]);
/* write: >=0 bytes, 0 would-block, -1 permanent failure. */
int hd_control_write(struct hd_control *s, const unsigned char *bytes, size_t length);
int hd_control_end(struct hd_control *s);
int hd_control_close(struct hd_control *s);
/* Concrete Linux backend, or a separately compiled explicit kernel fixture. */
long long hd_control_now(void);
/* One bounded nonblocking step: 0 connected, 1 pending, -1 failure. */
int hd_control_connect(struct hd_control *s);
int hd_control_observe(struct hd_control *s);
int hd_control_recv(struct hd_control *s, unsigned char out[4100]);
int hd_control_send(struct hd_control *s, const unsigned char *bytes, size_t length);
int hd_control_shutdown(struct hd_control *s);
int hd_control_close_fd(int fd);
#endif
