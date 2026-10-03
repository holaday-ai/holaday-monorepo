#define _GNU_SOURCE
#include "egress_native.h"
#include <errno.h>
#include <fcntl.h>
#include <poll.h>
#include <stddef.h>
#include <stdio.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/un.h>
#include <sys/xattr.h>
#include <time.h>
#include <unistd.h>
#ifdef HD_EGRESS_LINUX_TEST
#include "tests-fixtures/egress_native_linux_seam.h"
#else
#ifndef __linux__
#error "Production original-Node listener is Linux only"
#endif
#include <sys/random.h>
#include <sys/syscall.h>
#define HE_TID() ((pid_t)syscall(SYS_gettid))
#endif

long long hd_egress_now(void) {
    struct timespec ts;
    if (clock_gettime(CLOCK_MONOTONIC, &ts) || ts.tv_sec < 0 || ts.tv_nsec < 0 || ts.tv_nsec >= 1000000000)
        return -1;
    return ts.tv_sec * 1000LL + ts.tv_nsec / 1000000;
}
int hd_egress_close_fd(int fd) { return close(fd); }
static int remaining(const struct hd_egress *s) {
    long long now = hd_egress_now();
    return now < s->started || now - s->started >= 5000 ? -1 : (int)(5000 - (now - s->started));
}
static int identity(void) {
    uid_t u[3]; gid_t g[3];
    return getresuid(&u[0], &u[1], &u[2]) == 0 && u[0] == 998 && u[1] == 998 && u[2] == 998 &&
        getresgid(&g[0], &g[1], &g[2]) == 0 && g[0] == g[1] && g[1] == g[2] &&
        getpid() > 1 && HE_TID() == getpid() ? 0 : -1;
}
static int path_for(char *path, size_t size, int fd, int child) {
    int n = snprintf(path, size, child ? "/proc/self/fd/%d/egress.sock" : "/proc/self/fd/%d", fd);
    return n > 0 && (size_t)n < size ? 0 : -1;
}
static int same(const struct stat *a, const struct stat *b) {
    return a->st_dev == b->st_dev && a->st_ino == b->st_ino && a->st_mode == b->st_mode &&
        a->st_uid == b->st_uid && a->st_gid == b->st_gid;
}
static int attrs(int fd, int leaf) {
    char names[4096], path[80];
    if (path_for(path, sizeof(path), fd, 0)) return -1;
    ssize_t n = leaf ? listxattr(path, names, sizeof(names)) : flistxattr(fd, names, sizeof(names));
    if (n < 0 || (size_t)n > sizeof(names)) return -1;
    for (size_t i = 0; i < (size_t)n;) {
        char *end = memchr(names + i, 0, (size_t)n - i);
        if (!end || !strcmp(names + i, "system.posix_acl_access") ||
            !strcmp(names + i, "system.posix_acl_default") || !strcmp(names + i, "security.capability")) return -1;
        i = (size_t)(end - names) + 1;
    }
    return 0;
}
static int directory(int fd, int app) {
    struct stat st;
    int flags = fcntl(fd, F_GETFD);
    return fstat(fd, &st) == 0 && S_ISDIR(st.st_mode) &&
        st.st_uid == (uid_t)(app ? 998 : 0) && (!app || st.st_gid == getgid()) &&
        (st.st_mode & 07777) == (app ? 0700 : 0755) &&
        flags >= 0 && (flags & FD_CLOEXEC) && attrs(fd, 0) == 0 ? 0 : -1;
}
static int open_dir(int parent, const char *name, int app) {
    int fd = openat(parent, name, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
    if (fd >= 0 && directory(fd, app)) { close(fd); return -1; }
    return fd;
}
static int leaf(const struct hd_egress *s, int ready) {
    struct stat held, current;
    int fd = s->fds[HE_LEAF_FD], flags = fcntl(fd, F_GETFD);
    if (fstat(fd, &held) || fstatat(s->fds[HE_PARENT_FD], "egress.sock", &current, AT_SYMLINK_NOFOLLOW) ||
        !same(&held, &current) || !S_ISSOCK(held.st_mode) || held.st_uid != 998 ||
        held.st_gid != getgid() || held.st_nlink != 1 || (held.st_mode & 07000) ||
        (ready && (held.st_mode & 0777) != 0666) || flags < 0 || !(flags & FD_CLOEXEC) || attrs(fd, 1)) return -1;
    return 0;
}
static int chain(const struct hd_egress *s) {
    struct stat held, current;
    for (int i = 0; i < 3; ++i) {
        if (directory(s->fds[i], i == 2) || fstat(s->fds[i], &held)) return -1;
        const char *name = i == 0 ? "/" : i == 1 ? "run" : "holaday-pool-egress";
        int parent = i == 0 ? AT_FDCWD : s->fds[i - 1];
        if (fstatat(parent, name, &current, AT_SYMLINK_NOFOLLOW) || !same(&held, &current)) return -1;
    }
    return 0;
}
static int wait_io(int fd, short events, const struct hd_egress *s) {
    for (;;) {
        int ms = remaining(s);
        if (ms <= 0) return -1;
        struct pollfd p = {fd, events, 0};
        int n = poll(&p, 1, ms);
        if (n < 0 && errno == EINTR) continue;
        return n == 1 && p.revents == events && remaining(s) > 0 ? 0 : -1;
    }
}
static int peer(int fd) {
    struct ucred c;
    socklen_t size = sizeof(c);
    return getsockopt(fd, SOL_SOCKET, SO_PEERCRED, &c, &size) == 0 && size == sizeof(c) &&
        c.pid == getpid() && c.uid == 998 && c.gid == getgid() ? 0 : -1;
}
static int probe(const struct hd_egress *s) {
    int client = -1, accepted = -1, result = -1;
    unsigned char nonce[32], received[33];
    struct sockaddr_un address = {0};
    address.sun_family = AF_UNIX;
    if (leaf(s, 0) || chain(s) || path_for(address.sun_path, sizeof(address.sun_path), s->fds[HE_LEAF_FD], 0) ||
        remaining(s) <= 0 || getrandom(nonce, sizeof(nonce), GRND_NONBLOCK) != sizeof(nonce)) goto out;
    unsigned char any = 0;
    for (size_t i = 0; i < sizeof(nonce); ++i) any |= nonce[i];
    if (!any || remaining(s) <= 0) goto out;
    client = socket(AF_UNIX, SOCK_STREAM | SOCK_NONBLOCK | SOCK_CLOEXEC, 0);
    if (client < 0 || remaining(s) <= 0) goto out;
    if (connect(client, (struct sockaddr *)&address, sizeof(address)) != 0) {
        if (errno != EINPROGRESS || wait_io(client, POLLOUT, s)) goto out;
        int error = -1; socklen_t length = sizeof(error);
        if (getsockopt(client, SOL_SOCKET, SO_ERROR, &error, &length) || length != sizeof(error) || error) goto out;
    }
    if (remaining(s) <= 0 || peer(client) || wait_io(s->fds[HE_LISTENER_FD], POLLIN, s)) goto out;
    accepted = accept4(s->fds[HE_LISTENER_FD], NULL, NULL, SOCK_NONBLOCK | SOCK_CLOEXEC);
    int enable = 1;
    if (accepted < 0 || remaining(s) <= 0 || peer(accepted) || remaining(s) <= 0 ||
        setsockopt(accepted, SOL_SOCKET, SO_PASSCRED, &enable, sizeof(enable))) goto out;
    size_t sent = 0, used = 0;
    while (sent < sizeof(nonce)) {
        if (wait_io(client, POLLOUT, s)) goto out;
        ssize_t n = send(client, nonce + sent, sizeof(nonce) - sent, MSG_NOSIGNAL);
        if (n < 0 && (errno == EAGAIN || errno == EINTR)) continue;
        if (n <= 0 || (size_t)n > sizeof(nonce) - sent || remaining(s) <= 0) goto out;
        sent += (size_t)n;
    }
    while (used < sizeof(nonce)) {
        if (wait_io(accepted, POLLIN, s)) goto out;
        union { struct cmsghdr align; char bytes[CMSG_SPACE(253 * sizeof(int)) + CMSG_SPACE(sizeof(struct ucred))]; } control;
        struct iovec io = {received + used, sizeof(received) - used};
        struct msghdr msg = {0};
        msg.msg_iov = &io; msg.msg_iovlen = 1;
        msg.msg_control = control.bytes; msg.msg_controllen = sizeof(control.bytes);
        ssize_t n = recvmsg(accepted, &msg, MSG_CMSG_CLOEXEC);
        if (n < 0 && (errno == EAGAIN || errno == EINTR)) continue;
        int credentials = 0, bad = 0;
        if (n >= 0) for (struct cmsghdr *c = CMSG_FIRSTHDR(&msg); c; c = CMSG_NXTHDR(&msg, c)) {
            if (c->cmsg_len < CMSG_LEN(0)) { bad = 1; break; }
            size_t payload = c->cmsg_len - CMSG_LEN(0);
            if (c->cmsg_level == SOL_SOCKET && c->cmsg_type == SCM_RIGHTS) {
                bad = 1;
                for (size_t i = 0; i + sizeof(int) <= payload; i += sizeof(int)) {
                    int fd; memcpy(&fd, (char *)CMSG_DATA(c) + i, sizeof(fd));
                    if (fd >= 0) close(fd);
                }
            } else if (c->cmsg_level == SOL_SOCKET && c->cmsg_type == SCM_CREDENTIALS && payload == sizeof(struct ucred)) {
                struct ucred sender; memcpy(&sender, CMSG_DATA(c), sizeof(sender));
                ++credentials;
                if (sender.pid != getpid() || sender.uid != 998 || sender.gid != getgid()) bad = 1;
            } else bad = 1;
        }
        if (n <= 0 || (size_t)n > sizeof(nonce) - used || bad || credentials != 1 ||
            (msg.msg_flags & ~MSG_CMSG_CLOEXEC) || remaining(s) <= 0) goto out;
        used += (size_t)n;
    }
    if (memcmp(nonce, received, sizeof(nonce)) || peer(client) || peer(accepted) || leaf(s, 0) || chain(s) || remaining(s) <= 0) goto out;
    result = 0;
out:
    memset(nonce, 0, sizeof(nonce)); memset(received, 0, sizeof(received));
    if (accepted >= 0 && close(accepted)) result = -1;
    if (client >= 0 && close(client)) result = -1;
    if (remaining(s) <= 0) result = -1;
    return result;
}
int hd_egress_step(enum hd_egress_op op, const struct hd_egress *s) {
    if (op == HE_IDENTITY) return identity();
    if (op == HE_ROOT) return open_dir(AT_FDCWD, "/", 0);
    if (op == HE_RUN) return open_dir(s->fds[HE_ROOT_FD], "run", 0);
    if (op == HE_PARENT) return open_dir(s->fds[HE_RUN_FD], "holaday-pool-egress", 1);
    if (op == HE_LISTENER) return socket(AF_UNIX, SOCK_STREAM | SOCK_NONBLOCK | SOCK_CLOEXEC, 0);
    if (op == HE_BIND) {
        struct sockaddr_un a = {0}; a.sun_family = AF_UNIX;
        if (chain(s) || path_for(a.sun_path, sizeof(a.sun_path), s->fds[HE_PARENT_FD], 1) || remaining(s) <= 0) return -1;
        return bind(s->fds[HE_LISTENER_FD], (struct sockaddr *)&a, sizeof(a));
    }
    if (op == HE_LISTEN) return listen(s->fds[HE_LISTENER_FD], 64);
    if (op == HE_LEAF) return openat(s->fds[HE_PARENT_FD], "egress.sock", O_PATH | O_NOFOLLOW | O_CLOEXEC);
    if (op == HE_PROBE) return probe(s);
    if (op == HE_MODE) {
        char path[80];
        if (leaf(s, 0) || chain(s) || path_for(path, sizeof(path), s->fds[HE_LEAF_FD], 0) || remaining(s) <= 0) return -1;
        return chmod(path, 0666); /* Only the held, self-proven original O_PATH object. */
    }
    if (op == HE_VERIFY) {
        int listening = 0; socklen_t size = sizeof(listening);
        return identity() == 0 && chain(s) == 0 && leaf(s, 1) == 0 &&
            getsockopt(s->fds[HE_LISTENER_FD], SOL_SOCKET, SO_ACCEPTCONN, &listening, &size) == 0 &&
            size == sizeof(listening) && listening == 1 ? 0 : -1;
    }
    return -1;
}
