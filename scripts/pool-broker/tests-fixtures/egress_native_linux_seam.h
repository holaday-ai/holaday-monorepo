#ifndef HE_LINUX_TEST_SEAM_H
#define HE_LINUX_TEST_SEAM_H
/* Explicit Darwin-hosted Linux syscall boundary; NEVER a production build. */
#ifndef HD_EGRESS_LINUX_TEST
#error "Test only"
#endif
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <poll.h>
#include <time.h>
#include <fcntl.h>
#ifdef __APPLE__
struct ucred { pid_t pid; uid_t uid; gid_t gid; };
#define O_PATH 0x200000
#define SOCK_NONBLOCK 0x800
#define SOCK_CLOEXEC 0x80000
#define SO_PEERCRED 1700
#define SO_PASSCRED 1600
#define SCM_CREDENTIALS 2000
#define MSG_CMSG_CLOEXEC 0x40000000
#define GRND_NONBLOCK 1
#endif
#define HE_TID() he_test_tid()
pid_t he_test_tid(void);
int he_clock_gettime(clockid_t id, struct timespec *time);
int he_close(int fd);
int he_getresuid(uid_t *a, uid_t *b, uid_t *c);
int he_getresgid(gid_t *a, gid_t *b, gid_t *c);
pid_t he_getpid(void);
gid_t he_getgid(void);
ssize_t he_flistxattr(int fd, char *buffer, size_t size);
ssize_t he_listxattr(const char *path, char *buffer, size_t size);
int he_fcntl(int fd, int cmd, ...);
int he_fstat(int fd, struct stat *st);
int he_fstatat(int fd, const char *name, struct stat *st, int flags);
int he_openat(int fd, const char *name, int flags, ...);
int he_poll(struct pollfd *fds, nfds_t count, int ms);
int he_getsockopt(int fd, int level, int name, void *buffer, socklen_t *size);
ssize_t he_getrandom(void *buffer, size_t size, unsigned int flags);
int he_socket(int domain, int type, int protocol);
int he_connect(int fd, const struct sockaddr *addr, socklen_t size);
int he_accept4(int fd, struct sockaddr *addr, socklen_t *size, int flags);
int he_setsockopt(int fd, int level, int name, const void *buffer, socklen_t size);
ssize_t he_send(int fd, const void *buffer, size_t size, int flags);
ssize_t he_recvmsg(int fd, struct msghdr *msg, int flags);
int he_bind(int fd, const struct sockaddr *addr, socklen_t size);
int he_listen(int fd, int backlog);
int he_chmod(const char *path, mode_t mode);
#define clock_gettime he_clock_gettime
#define close he_close
#define getresuid he_getresuid
#define getresgid he_getresgid
#define getpid he_getpid
#define getgid he_getgid
#define flistxattr he_flistxattr
#define listxattr he_listxattr
#define fcntl he_fcntl
#define fstat he_fstat
#define fstatat he_fstatat
#define openat he_openat
#define poll he_poll
#define getsockopt he_getsockopt
#define getrandom he_getrandom
#define socket he_socket
#define connect he_connect
#define accept4 he_accept4
#define setsockopt he_setsockopt
#define send he_send
#define recvmsg he_recvmsg
#define bind he_bind
#define listen he_listen
#define chmod he_chmod
#endif
