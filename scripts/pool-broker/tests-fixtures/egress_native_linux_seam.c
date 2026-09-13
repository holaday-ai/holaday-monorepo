#include "../egress_native.h"
#include <assert.h>
#include <errno.h>
#include <stdio.h>
#include <string.h>
#include <sys/un.h>
#include "egress_native_linux_seam.h"

static int calls, fail_at, late_at, faults, nextfd, live[64], made[64], leafmode, probed, mode_set;
static long long milliseconds;
static unsigned char sent[32];
static size_t sent_bytes, received_bytes;
static int send_again, recv_again;
static int check(void) {
    ++calls;
    if (calls == late_at) milliseconds += 5000;
    if (calls == fail_at) { errno = EIO; return -1; }
    return 0;
}
static int fd_new(void) { assert(nextfd < 64); live[nextfd] = made[nextfd] = 1; return nextfd++; }
static void fd_live(int fd) { assert(fd >= 10 && fd < 64 && live[fd]); }
int he_clock_gettime(clockid_t id, struct timespec *time) {
    assert(id == CLOCK_MONOTONIC);
    time->tv_sec = milliseconds / 1000; time->tv_nsec = (milliseconds % 1000) * 1000000;
    return 0;
}
int he_close(int fd) { fd_live(fd); live[fd] = 0; return check(); }
int he_getresuid(uid_t *a, uid_t *b, uid_t *c) { *a = *b = *c = faults == 1 ? 0 : 998; return check(); }
int he_getresgid(gid_t *a, gid_t *b, gid_t *c) { *a = *b = *c = 515; return check(); }
pid_t he_getpid(void) { return 1234; }
pid_t he_test_tid(void) { return faults == 2 ? 1235 : 1234; }
gid_t he_getgid(void) { return 515; }
static int path_fd(const char *path, int child) {
    int fd = -1, n = 0;
    assert(sscanf(path, "/proc/self/fd/%d%n", &fd, &n) == 1);
    assert(!strcmp(path + n, child ? "/egress.sock" : ""));
    fd_live(fd); return fd;
}
ssize_t he_flistxattr(int fd, char *buffer, size_t size) {
    fd_live(fd); assert(size == 4096);
    if (check()) return -1;
    if (faults == 3) { const char value[] = "system.posix_acl_access"; memcpy(buffer, value, sizeof(value)); return sizeof(value); }
    return 0;
}
ssize_t he_listxattr(const char *path, char *buffer, size_t size) {
    assert(path_fd(path, 0) == 14); return he_flistxattr(14, buffer, size);
}
int he_fcntl(int fd, int cmd, ...) { fd_live(fd); assert(cmd == F_GETFD); return check() ? -1 : FD_CLOEXEC; }
static void metadata(int fd, struct stat *st) {
    memset(st, 0, sizeof(*st));
    st->st_dev = 1; st->st_ino = (ino_t)fd; st->st_nlink = 1;
    st->st_uid = fd < 12 ? 0 : 998; st->st_gid = fd < 12 ? 0 : 515;
    st->st_mode = fd < 12 ? S_IFDIR | 0755 : fd == 12 ? S_IFDIR | 0700 : S_IFSOCK | leafmode;
    if (faults == 4 && fd == 12) st->st_mode = S_IFDIR | 0770;
    if (faults == 5 && fd == 14) st->st_mode = S_IFLNK | 0777;
    if (faults == 6 && fd == 14) st->st_uid = 999;
    if (faults == 7 && fd == 14) st->st_nlink = 2;
}
int he_fstat(int fd, struct stat *st) { fd_live(fd); if (check()) return -1; metadata(fd, st); return 0; }
int he_fstatat(int fd, const char *name, struct stat *st, int flags) {
    assert(flags == AT_SYMLINK_NOFOLLOW);
    int target;
    if (fd == AT_FDCWD) { assert(!strcmp(name, "/")); target = 10; }
    else {
        fd_live(fd);
        if (fd == 10) { assert(!strcmp(name, "run")); target = 11; }
        else if (fd == 11) { assert(!strcmp(name, "holaday-pool-egress")); target = 12; }
        else { assert(fd == 12 && !strcmp(name, "egress.sock")); target = 14; }
    }
    if (check()) return -1;
    metadata(target, st);
    if (faults == 8 && target == 14) st->st_ino++;
    if (faults == 9 && target == 12) st->st_ino++;
    return 0;
}
int he_openat(int fd, const char *name, int flags, ...) {
    if (fd == AT_FDCWD) assert(!strcmp(name, "/"));
    else { fd_live(fd); assert(!strcmp(name, fd == 10 ? "run" : fd == 11 ? "holaday-pool-egress" : "egress.sock")); }
    int expected = !strcmp(name, "egress.sock") ? O_PATH : O_RDONLY | O_DIRECTORY;
    assert(flags == (expected | O_NOFOLLOW | O_CLOEXEC));
    return check() ? -1 : fd_new();
}
int he_poll(struct pollfd *fds, nfds_t count, int ms) {
    assert(count == 1 && ms > 0 && ms <= 5000); fd_live(fds[0].fd);
    if (check()) return -1;
    fds[0].revents = fds[0].events; return 1;
}
int he_getsockopt(int fd, int level, int name, void *buffer, socklen_t *size) {
    fd_live(fd); assert(level == SOL_SOCKET);
    if (check()) return -1;
    if (name == SO_PEERCRED) {
        assert(*size == sizeof(struct ucred));
        struct ucred c = {1234, 998, 515};
        if ((faults == 10 && fd == 15) || (faults == 11 && fd == 16)) c.pid++;
        memcpy(buffer, &c, sizeof(c));
    } else if (name == SO_ERROR) { assert(fd == 15); *(int *)buffer = 0; }
    else { assert(name == SO_ACCEPTCONN && fd == 13); *(int *)buffer = faults == 17 ? 0 : 1; }
    return 0;
}
ssize_t he_getrandom(void *buffer, size_t size, unsigned int flags) {
    assert(size == 32 && flags == GRND_NONBLOCK); if (check()) return -1;
    memset(buffer, faults == 12 ? 0 : 7, size); return (ssize_t)size;
}
int he_socket(int domain, int type, int protocol) {
    assert(domain == AF_UNIX && type == (SOCK_STREAM | SOCK_NONBLOCK | SOCK_CLOEXEC) && protocol == 0);
    return check() ? -1 : fd_new();
}
int he_connect(int fd, const struct sockaddr *addr, socklen_t size) {
    assert(fd == 15 && size == sizeof(struct sockaddr_un));
    assert(path_fd(((const struct sockaddr_un *)addr)->sun_path, 0) == 14);
    if (check()) return -1;
    if (faults == 20) { errno = EINPROGRESS; return -1; }
    return 0;
}
int he_accept4(int fd, struct sockaddr *addr, socklen_t *size, int flags) {
    assert(fd == 13 && addr == NULL && size == NULL && flags == (SOCK_NONBLOCK | SOCK_CLOEXEC));
    return check() ? -1 : fd_new();
}
int he_setsockopt(int fd, int level, int name, const void *buffer, socklen_t size) {
    assert(milliseconds < 5100); /* Real dispatch must not begin after the original deadline. */
    assert(fd == 16 && level == SOL_SOCKET && name == SO_PASSCRED && size == sizeof(int) && *(const int *)buffer == 1);
    return check();
}
ssize_t he_send(int fd, const void *buffer, size_t size, int flags) {
    assert(fd == 15 && size == 32 - sent_bytes && flags == MSG_NOSIGNAL);
    if (check()) return -1;
    if (faults == 19 && !send_again++) { errno = EAGAIN; return -1; }
    size_t n = faults == 18 && size > 16 ? 16 : size;
    memcpy(sent + sent_bytes, buffer, n); sent_bytes += n; return (ssize_t)n;
}
ssize_t he_recvmsg(int fd, struct msghdr *msg, int flags) {
    assert(fd == 16 && flags == MSG_CMSG_CLOEXEC && msg->msg_iovlen == 1 && msg->msg_iov[0].iov_len == 33 - received_bytes);
    if (check()) return -1;
    if (faults == 19 && !recv_again++) { errno = EAGAIN; return -1; }
    size_t n = faults == 18 && received_bytes == 0 ? 16 : 32 - received_bytes;
    memcpy(msg->msg_iov[0].iov_base, sent + received_bytes, n); received_bytes += n;
    if (faults == 13) ((unsigned char *)msg->msg_iov[0].iov_base)[0]++;
    struct cmsghdr *c = CMSG_FIRSTHDR(msg);
    c->cmsg_level = SOL_SOCKET;
    if (faults == 14 || faults == 21) {
        c->cmsg_type = SCM_RIGHTS; c->cmsg_len = CMSG_LEN(sizeof(int));
        int right = fd_new(); memcpy(CMSG_DATA(c), &right, sizeof(right));
        msg->msg_controllen = CMSG_SPACE(sizeof(int));
        if (faults == 21) {
            c->cmsg_len = CMSG_LEN(2 * sizeof(int));
            right = fd_new(); memcpy((char *)CMSG_DATA(c) + sizeof(int), &right, sizeof(right));
            msg->msg_controllen = CMSG_SPACE(2 * sizeof(int));
        }
    } else {
        c->cmsg_type = SCM_CREDENTIALS; c->cmsg_len = CMSG_LEN(sizeof(struct ucred));
        struct ucred cred = {faults == 15 ? 1235 : 1234, 998, 515};
        memcpy(CMSG_DATA(c), &cred, sizeof(cred)); msg->msg_controllen = CMSG_SPACE(sizeof(cred));
    }
    msg->msg_flags = faults == 21 ? MSG_CTRUNC : 0; probed = 1; return (ssize_t)n;
}
int he_bind(int fd, const struct sockaddr *addr, socklen_t size) {
    assert(milliseconds < 5100);
    assert(fd == 13 && size == sizeof(struct sockaddr_un));
    assert(path_fd(((const struct sockaddr_un *)addr)->sun_path, 1) == 12); return check();
}
int he_listen(int fd, int backlog) { assert(fd == 13 && backlog == 64); return check(); }
int he_chmod(const char *path, mode_t mode) {
    assert(milliseconds < 5100);
    assert(probed && mode == 0666 && path_fd(path, 0) == 14);
    if (check()) return -1;
    mode_set = 1; if (faults != 16) leafmode = mode; return 0;
}
static void reset(void) {
    for (int i = 0; i < 64; ++i) assert(!live[i]);
    memset(made, 0, sizeof(made)); calls = fail_at = late_at = faults = probed = mode_set = 0;
    milliseconds = 100; nextfd = 10; leafmode = 0755;
    sent_bytes = received_bytes = 0; send_again = recv_again = 0;
}
static void none(void) { for (int i = 0; i < 64; ++i) assert(!live[i]); }
int main(void) {
    struct hd_egress s;
    reset(); hd_egress_init(&s); assert(hd_egress_create(&s) == 0 && mode_set);
    int total = calls; assert(hd_egress_take(&s) == 13); assert(hd_egress_close(&s) == 0 && live[13]);
    assert(he_close(13) == 0); none();
    for (int i = 1; i <= total; ++i) {
        reset(); fail_at = i; hd_egress_init(&s);
        assert(hd_egress_create(&s) == -1); none();
        reset(); late_at = i; hd_egress_init(&s);
        assert(hd_egress_create(&s) == -1); none();
    }
    for (int i = 1; i <= 17; ++i) {
        reset(); faults = i; hd_egress_init(&s);
        assert(hd_egress_create(&s) == -1); none();
    }
    for (int i = 18; i <= 20; ++i) {
        reset(); faults = i; hd_egress_init(&s);
        assert(hd_egress_create(&s) == 0 && mode_set);
        assert(hd_egress_close(&s) == 0); none();
    }
    reset(); faults = 21; hd_egress_init(&s);
    assert(hd_egress_create(&s) == -1); none();
    return 0;
}
