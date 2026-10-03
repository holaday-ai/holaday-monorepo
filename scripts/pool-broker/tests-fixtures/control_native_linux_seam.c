#include "../control_native.h"
#include <assert.h>
#include <errno.h>
#include <stdio.h>
#include <string.h>
#include <sys/un.h>
#include "control_native_linux_seam.h"

static int calls, fail_at, late_at, live[32], dead, fault, ancillary, nonblock;
static int sends, receives, rights_closed;
static int publication;
static int connects, leaves, pins, pending_poll, refused_close_failure;
static int connect_jump, socket_polls;
static int short_jump_at, before_connect, before_send, before_recv, before_shutdown, shutdowns;
static long long milliseconds;
static int check(void) {
    ++calls;
    if (calls == late_at) milliseconds += 60000;
    if (calls == short_jump_at) milliseconds += 200;
    if (calls == fail_at) { errno = EIO; return -1; }
    return 0;
}
static void alive(int fd) { assert(fd >= 10 && fd < 32 && live[fd]); }
static int allocate(void) {
    for (int fd = 10; fd < 32; ++fd) if (!live[fd]) { live[fd] = 1; return fd; }
    assert(0); return -1;
}
int hc_clock(clockid_t kind, struct timespec *value) {
    assert(kind == CLOCK_MONOTONIC);
    value->tv_sec = milliseconds / 1000; value->tv_nsec = milliseconds % 1000 * 1000000;
    return 0;
}
int hc_close(int fd) {
    alive(fd); live[fd] = 0; if (fd >= 16) ++rights_closed;
    if (fd == 14 && refused_close_failure) return -1;
    return check();
}
int hc_uid(uid_t *a, uid_t *b, uid_t *c) { *a = *b = *c = fault == 1 ? 0 : 998; return check(); }
int hc_gid(gid_t *a, gid_t *b, gid_t *c) { *a = *b = *c = 515; return check(); }
pid_t hc_pid(void) { return 1234; }
pid_t hc_tid(void) { return fault == 2 ? 1235 : 1234; }
gid_t hc_getgid(void) { return 515; }
int hc_pin(pid_t pid) { assert(pid == 777); ++pins; return check() ? -1 : allocate(); }
int hc_fcntl(int fd, int cmd, ...) { alive(fd); assert(cmd == F_GETFD); return check() ? -1 : FD_CLOEXEC; }
ssize_t hc_fattrs(int fd, char *out, size_t size) {
    alive(fd); assert(size == 4096); if (check()) return -1;
    if (fault == 3) { const char key[] = "system.posix_acl_access"; memcpy(out, key, sizeof(key)); return sizeof(key); }
    return 0;
}
ssize_t hc_attrs(const char *path, char *out, size_t size) {
    assert(!strcmp(path, "/proc/self/fd/13")); return hc_fattrs(13, out, size);
}
static void metadata(int fd, struct stat *st) {
    memset(st, 0, sizeof(*st)); st->st_dev = 1; st->st_ino = (ino_t)fd; st->st_nlink = 1;
    st->st_uid = 0; st->st_gid = fd < 12 ? 0 : 515;
    st->st_mode = fd < 12 ? S_IFDIR | 0755 : fd == 12 ? S_IFDIR | 0750 : S_IFSOCK | 0660;
    if (fd == 13 && (publication == 2 || publication == 3)) {
        st->st_mode = S_IFSOCK | 0700; st->st_gid = publication == 2 ? 0 : 515;
    }
    if (fault == 4 && fd == 12) st->st_mode = S_IFDIR | 0770;
    if (fault == 5 && fd == 13) st->st_uid = 998;
    if (fault == 6 && fd == 13) st->st_mode = S_IFLNK | 0660;
    if (fault == 7 && fd == 13) st->st_nlink = 2;
}
int hc_fstat(int fd, struct stat *st) { alive(fd); if (check()) return -1; metadata(fd, st); return 0; }
int hc_fstatat(int fd, const char *name, struct stat *st, int flags) {
    assert(flags == AT_SYMLINK_NOFOLLOW);
    int target;
    if (fd == AT_FDCWD) { assert(!strcmp(name, "/")); target = 10; }
    else {
        alive(fd);
        if (fd == 10) { assert(!strcmp(name, "run")); target = 11; }
        else if (fd == 11) { assert(!strcmp(name, "holaday-pool-runtime")); target = 12; }
        else { assert(fd == 12 && !strcmp(name, "control.sock")); target = 13; }
    }
    if (check()) return -1;
    metadata(target, st);
    if ((fault == 8 && target == 12) || (fault == 9 && target == 13)) ++st->st_ino;
    return 0;
}
int hc_openat(int fd, const char *name, int flags, ...) {
    if (fd == AT_FDCWD) assert(!strcmp(name, "/"));
    else {
        alive(fd);
        assert(!strcmp(name, fd == 10 ? "run" : fd == 11 ? "holaday-pool-runtime" : "control.sock"));
    }
    assert(flags == ((!strcmp(name, "control.sock") ? O_PATH : O_RDONLY | O_DIRECTORY) | O_NOFOLLOW | O_CLOEXEC));
    if (publication == 1 && !strcmp(name, "control.sock")) { errno = ENOENT; return -1; }
    if (check()) return -1;
    if (!strcmp(name, "control.sock")) ++leaves;
    return allocate();
}
int hc_poll(struct pollfd *fds, nfds_t count, int ms) {
    assert(count == 1); alive(fds->fd);
    if (check()) return -1;
    assert(ms == 0);
    if (fds->fd == 15) { fds->revents = dead ? POLLIN : 0; return dead ? 1 : 0; }
    assert(fds->fd == 14);
    ++socket_polls;
    if (pending_poll) { fds->revents = 0; return 0; }
    fds->revents = POLLOUT; return 1;
}
int hc_getsockopt(int fd, int level, int name, void *out, socklen_t *length) {
    alive(fd); assert(fd == 14 && level == SOL_SOCKET); if (check()) return -1;
    if (name == SO_PEERCRED) {
        assert(*length == sizeof(struct ucred));
        struct ucred c = {fault == 10 ? 778 : 777, fault == 11 ? 998 : 0, 0};
        memcpy(out, &c, sizeof(c));
    } else {
        assert(*length == sizeof(int));
        assert(name == SO_ERROR || name == SO_TYPE);
        *(int *)out = name == SO_TYPE ? SOCK_STREAM : 0;
    }
    return 0;
}
int hc_socket(int domain, int type, int protocol) {
    assert(domain == AF_UNIX && type == (SOCK_STREAM | SOCK_NONBLOCK | SOCK_CLOEXEC) && !protocol);
    return check() ? -1 : allocate();
}
int hc_connect(int fd, const struct sockaddr *addr, socklen_t size) {
    before_connect = calls;
    ++connects;
    alive(fd); assert(fd == 14 && size == sizeof(struct sockaddr_un));
    assert(!strcmp(((const struct sockaddr_un *)addr)->sun_path, "/proc/self/fd/13"));
    if (check()) return -1;
    if (publication == 4) { errno = ECONNREFUSED; return -1; }
    if (nonblock) { milliseconds += connect_jump; errno = EINPROGRESS; return -1; }
    return 0;
}
int hc_setsockopt(int fd, int level, int option, const void *value, socklen_t size) {
    alive(fd); assert(fd == 14 && level == SOL_SOCKET && option == SO_PASSCRED);
    assert(size == sizeof(int) && *(const int *)value == 1); return check();
}
ssize_t hc_send(int fd, const void *bytes, size_t length, int flags) {
    before_send = calls;
    alive(fd); assert(bytes && length && flags == (MSG_DONTWAIT | MSG_NOSIGNAL));
    ++sends; return check() ? -1 : (ssize_t)length;
}
ssize_t hc_recvmsg(int fd, struct msghdr *msg, int flags) {
    before_recv = calls;
    alive(fd); assert(fd == 14 && flags == (MSG_CMSG_CLOEXEC | MSG_DONTWAIT));
    assert(msg->msg_iovlen == 1 && msg->msg_iov[0].iov_len == 4100);
    ++receives; if (check()) return -1;
    if (ancillary == 8) { errno = EAGAIN; return -1; }
    *(unsigned char *)msg->msg_iov[0].iov_base = 7;
    struct cmsghdr *c = msg->msg_control;
    struct ucred peer = {ancillary == 2 ? 778 : 777, 0, 0};
    c->cmsg_level = SOL_SOCKET; c->cmsg_type = SCM_CREDENTIALS; c->cmsg_len = CMSG_LEN(sizeof(peer));
    memcpy(CMSG_DATA(c), &peer, sizeof(peer)); msg->msg_controllen = CMSG_SPACE(sizeof(peer));
    if (ancillary == 1 || ancillary == 4 || ancillary == 6) {
        struct cmsghdr *next = (struct cmsghdr *)((unsigned char *)c + CMSG_SPACE(sizeof(peer)));
        next->cmsg_level = SOL_SOCKET;
        next->cmsg_type = ancillary == 1 ? SCM_RIGHTS : ancillary == 4 ? SCM_CREDENTIALS : 991;
        if (ancillary == 1) {
            int right = allocate(); assert(right == 16);
            next->cmsg_len = CMSG_LEN(sizeof(right)); memcpy(CMSG_DATA(next), &right, sizeof(right));
            msg->msg_controllen += CMSG_SPACE(sizeof(right));
        } else {
            next->cmsg_len = CMSG_LEN(sizeof(peer)); memcpy(CMSG_DATA(next), &peer, sizeof(peer));
            msg->msg_controllen += CMSG_SPACE(sizeof(peer));
        }
    }
    if (ancillary == 3 || ancillary == 7) msg->msg_controllen = 0;
    if (ancillary == 5) msg->msg_flags = MSG_CTRUNC;
    if (ancillary == 9) dead = 1;
    return ancillary == 7 ? 0 : 1;
}
int hc_shutdown(int fd, int how) {
    before_shutdown = calls; ++shutdowns;
    alive(fd); assert(fd == 14 && how == SHUT_WR); return check();
}
static void setup(struct hd_control *s) {
    calls = fail_at = late_at = dead = fault = ancillary = nonblock = sends = receives = rights_closed = 0;
    milliseconds = 100; memset(live, 0, sizeof(live)); hd_control_init(s);
    publication = 0;
    connects = leaves = pins = pending_poll = refused_close_failure = 0;
    connect_jump = socket_polls = 0;
    short_jump_at = before_connect = before_send = before_recv = before_shutdown = shutdowns = 0;
}
static void empty(void) { for (int i = 10; i < 32; ++i) assert(!live[i]); }
int main(void) {
    struct hd_control s; unsigned char bytes[4100] = {0};
    setup(&s); assert(hd_control_open(&s) == 0); int creation_calls = calls;
    assert(hd_control_read(&s, bytes) == 1 && bytes[0] == 7);
    assert(hd_control_write(&s, bytes, 1) == 1); assert(hd_control_end(&s) == 0);
    assert(hd_control_close(&s) == 0); empty();
    /* Loader consumed 4.9s before this native owner existed. Advance time in
     * the last actual identity observation, not after the IO being asserted. */
    setup(&s); assert(hd_control_open(&s) == 0);
    int connect_boundary = before_connect;
    hd_control_close(&s); empty();
    setup(&s); milliseconds = 4900; s.scope_deadline = 5000;
    short_jump_at = connect_boundary;
    int opened = hd_control_open(&s);
    assert(connects == 0 && opened == -1); empty();
    for (int action = 0; action < 3; ++action) {
        setup(&s); assert(hd_control_open(&s) == 0);
        int begin_io = calls;
        int result = action == 0 ? hd_control_write(&s, bytes, 1) :
            action == 1 ? hd_control_read(&s, bytes) : hd_control_end(&s);
        assert(result >= 0);
        int boundary = (action == 0 ? before_send : action == 1 ? before_recv : before_shutdown) - begin_io;
        hd_control_close(&s); empty();
        setup(&s); milliseconds = 4900; s.scope_deadline = 5000;
        assert(hd_control_open(&s) == 0);
        short_jump_at = calls + boundary;
        result = action == 0 ? hd_control_write(&s, bytes, 1) :
            action == 1 ? hd_control_read(&s, bytes) : hd_control_end(&s);
        assert(sends == 0 && receives == 0 && shutdowns == 0 && result == -1); empty();
    }
    /* Every real listener publication stage precedes a single business stream.
     * The 0700 stages are waiting only; no socket connect or protocol send. */
    for (int stage = 1; stage <= 4; ++stage) {
        setup(&s); publication = stage;
        assert(hd_control_open(&s) == 0 && !s.connected);
        assert(hd_control_ready(&s) == 0 && !s.connected);
        assert(pins == 0 && sends == 0 && receives == 0);
        if (stage < 4) assert(connects == 0);
        milliseconds += 40; publication = 0;
        assert(hd_control_ready(&s) == 1 && s.connected);
        assert(leaves == 1 && pins == 1);
        int connected_attempts = connects;
        assert(hd_control_ready(&s) == 1 && connects == connected_attempts && pins == 1);
        assert(hd_control_write(&s, bytes, 1) == 1 && sends == 1);
        assert(hd_control_close(&s) == 0); empty();
    }
    setup(&s); publication = 2; assert(hd_control_open(&s) == 0);
    publication = 3; assert(hd_control_ready(&s) == 0);
    publication = 2; assert(hd_control_ready(&s) == -1);
    assert(connects == 0 && leaves == 1); empty();
    for (int mode = 3; mode <= 9; ++mode) {
        setup(&s); publication = 3; assert(hd_control_open(&s) == 0);
        publication = 0; fault = mode;
        assert(hd_control_ready(&s) == -1 && connects == 0 && leaves == 1); empty();
    }
    setup(&s); publication = 1; assert(hd_control_open(&s) == 0);
    milliseconds += 5000; publication = 0;
    assert(hd_control_ready(&s) == -1 && leaves == 0 && connects == 0); empty();
    setup(&s); publication = 3; assert(hd_control_open(&s) == 0);
    milliseconds += 4900; publication = 0; late_at = calls + 1;
    assert(hd_control_ready(&s) == -1 && sends == 0); empty();
    setup(&s); publication = 3; assert(hd_control_open(&s) == 0);
    assert(hd_control_close(&s) == 0); publication = 0;
    assert(hd_control_ready(&s) == -1 && connects == 0); empty();
    setup(&s); nonblock = pending_poll = 1;
    assert(hd_control_open(&s) == 0 && !s.connected);
    assert(hd_control_ready(&s) == 0 && connects == 1 && pins == 0);
    pending_poll = 0;
    assert(hd_control_ready(&s) == 1 && connects == 1 && pins == 1);
    assert(hd_control_close(&s) == 0); empty();
    setup(&s); nonblock = 1; connect_jump = 5000;
    assert(hd_control_open(&s) == -1 && socket_polls == 0); empty();
    setup(&s); publication = 4; refused_close_failure = 1;
    assert(hd_control_open(&s) == -1 && s.cleanup_failed);
    assert(hd_control_close(&s) == -1 && connects == 1); empty();
    for (int action = 0; action < 3; ++action) {
        setup(&s); publication = 3; assert(hd_control_open(&s) == 0);
        int result = action == 0 ? hd_control_read(&s, bytes) : action == 1 ?
            hd_control_write(&s, bytes, 1) : hd_control_end(&s);
        assert(result == -1 && sends == 0 && receives == 0 && connects == 0); empty();
    }
    /* Any last acquisition/check/cleanup that crosses the original open limit
     * fails, even when the listener appeared just before that limit. */
    setup(&s); publication = 3; assert(hd_control_open(&s) == 0);
    int begin = calls; publication = 0; assert(hd_control_ready(&s) == 1);
    int final_calls = calls - begin; hd_control_close(&s); empty();
    for (int n = 1; n <= final_calls; ++n) {
        setup(&s); publication = 3; assert(hd_control_open(&s) == 0);
        milliseconds += 4900; publication = 0; late_at = calls + n;
        assert(hd_control_ready(&s) == -1 && sends == 0); empty();
    }
    for (int n = 1; n <= creation_calls; ++n) {
        setup(&s); fail_at = n; assert(hd_control_open(&s) == -1); empty();
        setup(&s); late_at = n; assert(hd_control_open(&s) == -1); empty();
    }
    for (int mode = 1; mode <= 11; ++mode) {
        setup(&s); assert(hd_control_open(&s) == 0); fault = mode;
        assert(hd_control_read(&s, bytes) == -1); assert(receives == 0); empty();
    }
    for (int mode = 1; mode <= 9; ++mode) {
        setup(&s); assert(hd_control_open(&s) == 0); ancillary = mode;
        int value = hd_control_read(&s, bytes);
        assert(value == (mode == 7 ? 0 : mode == 8 ? -2 : -1));
        if (mode == 1) assert(rights_closed == 1);
        hd_control_close(&s); empty();
    }
    setup(&s); nonblock = 1; assert(hd_control_open(&s) == 0); hd_control_close(&s); empty();
    setup(&s); assert(hd_control_open(&s) == 0); dead = 1;
    assert(hd_control_write(&s, bytes, 1) == -1 && sends == 0); empty();
    setup(&s); publication = 1;
    assert(hd_control_open(&s) == 0 && !s.connected);
    assert(sends == 0 && receives == 0);
    assert(hd_control_close(&s) == 0); empty();
    return 0;
}
