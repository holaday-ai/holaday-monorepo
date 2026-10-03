/* Darwin-only test fixture. Real socket+N-API, synthetic Linux identity/O_PATH. */
#ifndef __APPLE__
#error "Not a production Linux implementation"
#endif
#include "../egress_native.h"
#include <sys/socket.h>
#include <sys/un.h>
#include <time.h>
#include <fcntl.h>
#include <string.h>
#include <unistd.h>

long long hd_egress_now(void) {
    struct timespec ts;
    if (clock_gettime(CLOCK_MONOTONIC, &ts)) return -1;
    return ts.tv_sec * 1000LL + ts.tv_nsec / 1000000;
}
int hd_egress_close_fd(int fd) { return close(fd); }
void hd_egress_test_finalized(int transferred) {
    int fd = open(HE_TEST_PATH ".finalized", O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC, 0600);
    if (fd < 0) _exit(113);
    char value = transferred ? 't' : 'n';
    if (write(fd, &value, 1) != 1 || close(fd)) _exit(114);
}
int hd_egress_step(enum hd_egress_op op, const struct hd_egress *s) {
    if (op == HE_ROOT || op == HE_RUN || op == HE_PARENT || op == HE_LEAF)
        return open("/dev/null", O_RDONLY | O_CLOEXEC);
    if (op == HE_LISTENER) {
        int fd = socket(AF_UNIX, SOCK_STREAM, 0);
        if (fd < 0) return -1;
        if (fcntl(fd, F_SETFD, FD_CLOEXEC) < 0 || fcntl(fd, F_SETFL, O_NONBLOCK) < 0) {
            close(fd); return -1;
        }
        return fd;
    }
    if (op == HE_BIND) {
        struct sockaddr_un address = {0};
        address.sun_family = AF_UNIX;
        if (sizeof(HE_TEST_PATH) > sizeof(address.sun_path)) return -1;
        memcpy(address.sun_path, HE_TEST_PATH, sizeof(HE_TEST_PATH));
        return bind(s->fds[HE_LISTENER_FD], (struct sockaddr *)&address, sizeof(address));
    }
    if (op == HE_LISTEN) return listen(s->fds[HE_LISTENER_FD], 64);
    return 0;
}
