/* Real local stream; Linux identity and ancillary behavior tested separately. */
#include "../control_native.h"
#include <errno.h>
#include <fcntl.h>
#include <poll.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <time.h>
#include <unistd.h>
#include <uv.h>
#ifndef HC_TEST_PATH
#error "Explicit temporary local test socket only"
#endif
long long hd_control_now(void) {
    /* Same actual clock as this Node host, not Darwin CLOCK_MONOTONIC (which
     * has a different epoch). Production Linux still uses CLOCK_MONOTONIC;
     * this explicit local-socket fixture is not Linux identity proof. */
    return (long long)(uv_hrtime() / 1000000);
}
int hd_control_close_fd(int fd) { return close(fd); }
int hd_control_connect(struct hd_control *s) {
    int fd = s->fds[HC_SOCKET];
    if (fd < 0) {
        s->fds[HC_SOCKET] = socket(AF_UNIX, SOCK_STREAM, 0);
        fd = s->fds[HC_SOCKET];
        if (fd < 0 || fcntl(fd, F_SETFD, FD_CLOEXEC) || fcntl(fd, F_SETFL, O_NONBLOCK)) return -1;
        struct sockaddr_un address = {0}; address.sun_family = AF_UNIX;
        if (sizeof(HC_TEST_PATH) > sizeof(address.sun_path)) return -1;
        memcpy(address.sun_path, HC_TEST_PATH, sizeof(HC_TEST_PATH));
        if (connect(fd, (struct sockaddr *)&address, sizeof(address))) {
            int error = errno;
            if (error == ENOENT || error == ECONNREFUSED) {
                s->fds[HC_SOCKET] = -1;
                if (close(fd)) { s->cleanup_failed = 1; return -1; }
                return 1;
            }
            if (error != EINPROGRESS) return -1;
            s->connecting = 1;
        }
    }
    if (s->connecting) {
        struct pollfd p = {fd, POLLOUT, 0};
        int status = poll(&p, 1, 0);
        if (!status && !p.revents) return 1;
        if (status != 1 || p.revents != POLLOUT) return -1;
        int error = -1; socklen_t size = sizeof(error);
        if (getsockopt(fd, SOL_SOCKET, SO_ERROR, &error, &size) || error) return -1;
        s->connecting = 0;
    }
    return 0;
}
int hd_control_observe(struct hd_control *s) { return s->retired || fcntl(s->fds[HC_SOCKET], F_GETFD) < 0 ? -1 : 0; }
int hd_control_recv(struct hd_control *s, unsigned char out[4100]) {
    ssize_t n = recv(s->fds[HC_SOCKET], out, 4100, 0);
    return n < 0 ? (errno == EAGAIN || errno == EWOULDBLOCK ? -2 : -1) : (int)n;
}
int hd_control_send(struct hd_control *s, const unsigned char *bytes, size_t length) {
    ssize_t n = send(s->fds[HC_SOCKET], bytes, length, 0);
    return n < 0 ? (errno == EAGAIN || errno == EWOULDBLOCK ? 0 : -1) : (int)n;
}
int hd_control_shutdown(struct hd_control *s) { return shutdown(s->fds[HC_SOCKET], SHUT_WR); }
