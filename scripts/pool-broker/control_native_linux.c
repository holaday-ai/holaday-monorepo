#define _GNU_SOURCE
#include "control_native.h"
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <poll.h>
#include <stdio.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/un.h>
#include <sys/xattr.h>
#include <time.h>
#include <unistd.h>
#ifdef HD_CONTROL_LINUX_TEST
#include "tests-fixtures/control_native_linux_seam.h"
#else
#ifndef __linux__
#error "Production control receiver requires Linux"
#endif
#include <sys/syscall.h>
#define HC_TID() ((pid_t)syscall(SYS_gettid))
#define HC_PIN_OPEN(pid) ((int)syscall(SYS_pidfd_open, (pid), 0))
#endif

long long hd_control_now(void) {
    struct timespec ts;
    if (clock_gettime(CLOCK_MONOTONIC, &ts) || ts.tv_sec < 0 ||
        ts.tv_sec > LLONG_MAX / 1000 - 1 || ts.tv_nsec < 0 || ts.tv_nsec >= 1000000000) return -1;
    return ts.tv_sec * 1000LL + ts.tv_nsec / 1000000;
}
int hd_control_close_fd(int fd) { return close(fd); }
static int clock_ok(struct hd_control *s) {
    long long now = hd_control_now();
    long long limit = s->connected ? 60000 : 5000;
    if (s->retired || now < s->last || now < s->started ||
        (s->scope_deadline && now >= s->scope_deadline) || now - s->started >= limit) return -1;
    s->last = now;
    return 0;
}
static int identity(struct hd_control *s) {
    uid_t u[3]; gid_t g[3];
    return !clock_ok(s) && getresuid(&u[0], &u[1], &u[2]) == 0 &&
        u[0] == 998 && u[1] == 998 && u[2] == 998 &&
        getresgid(&g[0], &g[1], &g[2]) == 0 && g[0] == g[1] && g[1] == g[2] &&
        getpid() > 1 && (!s->app_pid || getpid() == s->app_pid) && HC_TID() == getpid() &&
        !clock_ok(s) ? 0 : -1;
}
static int same(const struct stat *a, const struct stat *b) {
    return a->st_dev == b->st_dev && a->st_ino == b->st_ino && a->st_uid == b->st_uid &&
        a->st_gid == b->st_gid && a->st_mode == b->st_mode;
}
static int descriptor(int fd) {
    int flags = fcntl(fd, F_GETFD);
    return fd >= 0 && flags >= 0 && (flags & FD_CLOEXEC) ? 0 : -1;
}
static int fd_path(char *path, size_t size, int fd) {
    int n = snprintf(path, size, "/proc/self/fd/%d", fd);
    return n > 0 && (size_t)n < size ? 0 : -1;
}
static int attrs(int fd, int leaf) {
    char names[4096], path[80];
    if (fd_path(path, sizeof(path), fd)) return -1;
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
static int directory(struct hd_control *s, int index) {
    struct stat held, named;
    int fd = s->fds[index];
    const char *name = index == 0 ? "/" : index == 1 ? "run" : "holaday-pool-runtime";
    if (clock_ok(s) || descriptor(fd) || fstat(fd, &held) || !S_ISDIR(held.st_mode) ||
        held.st_uid != 0 || held.st_gid != (index == 2 ? getgid() : 0) ||
        (held.st_mode & 07022) || (index == 2 && (held.st_mode & 07777) != 0750) ||
        attrs(fd, 0) || fstatat(index == 0 ? AT_FDCWD : s->fds[index - 1], name, &named,
            AT_SYMLINK_NOFOLLOW) || !same(&held, &named) || clock_ok(s)) return -1;
    return 0;
}
static int leaf(struct hd_control *s) {
    struct stat held, named;
    int fd = s->fds[HC_LEAF];
    if (clock_ok(s) || descriptor(fd) || fstat(fd, &held) ||
        !S_ISSOCK(held.st_mode) || (held.st_mode & 07777) != 0660 || held.st_uid != 0 ||
        held.st_gid != getgid() || held.st_nlink != 1 || attrs(fd, 1) ||
        fstatat(s->fds[HC_PARENT], "control.sock", &named, AT_SYMLINK_NOFOLLOW) ||
        !same(&held, &named) || clock_ok(s)) return -1;
    return 0;
}
static int pending_source(struct hd_control *s) {
    if (identity(s)) return -1;
    for (int i = 0; i < 3; ++i) if (directory(s, i)) return -1;
    return 0;
}
static int publication_stage(const struct stat *st, gid_t gid) {
    if (!S_ISSOCK(st->st_mode) || st->st_uid != 0 || st->st_nlink != 1) return -1;
    unsigned mode = st->st_mode & 07777;
    if (mode == 0700 && st->st_gid == 0) return 1;
    if (mode == 0700 && st->st_gid == gid) return 2;
    if (mode == 0660 && st->st_gid == gid) return 3;
    return -1;
}
/* A held O_PATH is never replaced. Only root's exact forward publication
 * sequence is pending, not an authorization or a permissive path retry. */
static int pending_leaf(struct hd_control *s) {
    struct stat held, named;
    int fd = s->fds[HC_LEAF];
    if (clock_ok(s) || descriptor(fd) || fstat(fd, &held) || attrs(fd, 1) ||
        fstatat(s->fds[HC_PARENT], "control.sock", &named, AT_SYMLINK_NOFOLLOW) ||
        held.st_dev != named.st_dev || held.st_ino != named.st_ino || clock_ok(s)) return -1;
    int before = publication_stage(&held, getgid()), after = publication_stage(&named, getgid());
    if (before < s->publication || before < 1 || after < before) return -1;
    s->publication = after;
    if (after != 3 || before != 3) return 1;
    return leaf(s);
}
static int peer(struct hd_control *s, int first) {
    struct ucred c;
    socklen_t length = sizeof(c);
    if (clock_ok(s) || getsockopt(s->fds[HC_SOCKET], SOL_SOCKET, SO_PEERCRED, &c, &length) ||
        length != sizeof(c) || c.uid != 0 || c.gid != 0 || c.pid <= 1 || c.pid == s->app_pid ||
        (!first && c.pid != s->root_pid) || clock_ok(s)) return -1;
    if (first) s->root_pid = c.pid;
    return 0;
}
static int pin(struct hd_control *s) {
    struct pollfd p = {s->fds[HC_PIN], POLLIN, 0};
    if (clock_ok(s) || descriptor(p.fd) || poll(&p, 1, 0) != 0 || p.revents || clock_ok(s)) return -1;
    return 0;
}
int hd_control_observe(struct hd_control *s) {
    if (identity(s)) return -1;
    for (int i = 0; i < 3; ++i) if (directory(s, i)) return -1;
    struct stat st;
    int type = 0;
    socklen_t size = sizeof(type);
    int fd = s->fds[HC_SOCKET];
    if (leaf(s) || descriptor(fd) || fstat(fd, &st) || !S_ISSOCK(st.st_mode) ||
        (uint64_t)st.st_dev != s->socket_device || (uint64_t)st.st_ino != s->socket_inode ||
        getsockopt(fd, SOL_SOCKET, SO_TYPE, &type, &size) || size != sizeof(type) || type != SOCK_STREAM ||
        peer(s, 0) || pin(s)) return -1;
    return 0;
}
int hd_control_connect(struct hd_control *s) {
    if (identity(s)) return -1;
    s->app_pid = getpid();
    for (int i = 0; i < 3; ++i) {
        const char *name = i == 0 ? "/" : i == 1 ? "run" : "holaday-pool-runtime";
        if (clock_ok(s)) return -1;
        if (s->fds[i] < 0) s->fds[i] = openat(i == 0 ? AT_FDCWD : s->fds[i - 1], name,
            O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
        if (s->fds[i] < 0 || directory(s, i)) return -1;
    }
    if (clock_ok(s)) return -1;
    if (s->fds[HC_LEAF] < 0) {
        s->fds[HC_LEAF] = openat(s->fds[HC_PARENT], "control.sock", O_PATH | O_NOFOLLOW | O_CLOEXEC);
        if (s->fds[HC_LEAF] < 0)
            return errno == ENOENT && !pending_source(s) ? 1 : -1;
    }
    int published = pending_leaf(s);
    if (published) return published > 0 && !pending_source(s) ? 1 : -1;
    int fd = s->fds[HC_SOCKET];
    if (fd < 0) {
        s->fds[HC_SOCKET] = socket(AF_UNIX, SOCK_STREAM | SOCK_NONBLOCK | SOCK_CLOEXEC, 0);
        fd = s->fds[HC_SOCKET];
        if (fd < 0 || clock_ok(s)) return -1;
        int one = 1;
        if (setsockopt(fd, SOL_SOCKET, SO_PASSCRED, &one, sizeof(one)) || clock_ok(s)) return -1;
        struct sockaddr_un address = {0};
        address.sun_family = AF_UNIX;
        if (fd_path(address.sun_path, sizeof(address.sun_path), s->fds[HC_LEAF]) || leaf(s)) return -1;
        int result = connect(fd, (struct sockaddr *)&address, sizeof(address));
        if (result) {
            int error = errno;
            if (error == ECONNREFUSED) {
                /* A failed connect sent no protocol bytes. Retire that socket,
                 * retaining the original leaf/parent and the same deadline. */
                s->fds[HC_SOCKET] = -1;
                if (close(fd)) { s->cleanup_failed = 1; return -1; }
                return !pending_source(s) && !leaf(s) ? 1 : -1;
            }
            if (error != EINPROGRESS) return -1;
            s->connecting = 1;
        }
    }
    if (s->connecting) {
        if (clock_ok(s)) return -1;
        struct pollfd p = {fd, POLLOUT, 0};
        int result = poll(&p, 1, 0); /* Node's owned timer advances us; never sleep here. */
        if (clock_ok(s)) return -1;
        if (!result && !p.revents) return !pending_source(s) && !leaf(s) ? 1 : -1;
        if (result != 1 || p.revents != POLLOUT) return -1;
        int error = -1; socklen_t size = sizeof(error);
        if (getsockopt(fd, SOL_SOCKET, SO_ERROR, &error, &size) || size != sizeof(error) || error) return -1;
        s->connecting = 0;
    }
    if (peer(s, 1)) return -1;
    s->fds[HC_PIN] = HC_PIN_OPEN(s->root_pid); /* Never reopened after any failure. */
    if (s->fds[HC_PIN] < 0 || pin(s) || peer(s, 0)) return -1;
    struct stat st;
    if (fstat(fd, &st) || !S_ISSOCK(st.st_mode) || clock_ok(s)) return -1;
    s->socket_device = (uint64_t)st.st_dev; s->socket_inode = (uint64_t)st.st_ino;
    return hd_control_observe(s);
}
int hd_control_recv(struct hd_control *s, unsigned char out[4100]) {
    if (hd_control_observe(s)) return -1;
    union { struct cmsghdr align; unsigned char bytes[CMSG_SPACE(sizeof(struct ucred)) + CMSG_SPACE(64 * sizeof(int))]; } ancillary;
    memset(&ancillary, 0, sizeof(ancillary));
    struct iovec io = {out, 4100};
    struct msghdr message = {0};
    message.msg_iov = &io; message.msg_iovlen = 1;
    message.msg_control = ancillary.bytes; message.msg_controllen = sizeof(ancillary.bytes);
    /* No userspace observer between the last original-pin veto and recvmsg. */
    if (pin(s)) return -1;
    ssize_t n = recvmsg(s->fds[HC_SOCKET], &message, MSG_CMSG_CLOEXEC | MSG_DONTWAIT);
    if (n < 0) return errno == EAGAIN || errno == EWOULDBLOCK ? -2 : -1;
    int bad = !!(message.msg_flags & (MSG_TRUNC | MSG_CTRUNC)), credentials = 0;
    for (struct cmsghdr *c = CMSG_FIRSTHDR(&message); c; c = CMSG_NXTHDR(&message, c)) {
        if (c->cmsg_len < CMSG_LEN(0)) { bad = 1; break; }
        size_t size = c->cmsg_len - CMSG_LEN(0);
        if (c->cmsg_level == SOL_SOCKET && c->cmsg_type == SCM_RIGHTS) {
            /* Every installed FD is owned before any validation or observer. */
            bad = 1;
            for (size_t i = 0; i + sizeof(int) <= size; i += sizeof(int)) {
                int received;
                memcpy(&received, (unsigned char *)CMSG_DATA(c) + i, sizeof(received));
                if (received >= 0 && close(received)) s->cleanup_failed = 1;
            }
        } else if (c->cmsg_level == SOL_SOCKET && c->cmsg_type == SCM_CREDENTIALS && size == sizeof(struct ucred)) {
            struct ucred value;
            memcpy(&value, CMSG_DATA(c), sizeof(value));
            ++credentials;
            if (value.pid != s->root_pid || value.uid != 0 || value.gid != 0) bad = 1;
        } else bad = 1;
    }
    if (credentials != (n ? 1 : 0) || bad || n > 4100 || hd_control_observe(s)) return -1;
    return (int)n;
}
int hd_control_send(struct hd_control *s, const unsigned char *bytes, size_t length) {
    if (hd_control_observe(s) || pin(s)) return -1;
    ssize_t n = send(s->fds[HC_SOCKET], bytes, length, MSG_DONTWAIT | MSG_NOSIGNAL);
    if (n < 0) return errno == EAGAIN || errno == EWOULDBLOCK ? 0 : -1;
    return (int)n;
}
int hd_control_shutdown(struct hd_control *s) {
    if (hd_control_observe(s) || pin(s)) return -1;
    return shutdown(s->fds[HC_SOCKET], SHUT_WR);
}
