#ifndef HC_LINUX_TEST_SEAM_H
#define HC_LINUX_TEST_SEAM_H
#ifndef HD_CONTROL_LINUX_TEST
#error "Explicit Linux syscall fixture only"
#endif
#include <sys/types.h>
#include <sys/socket.h>
#include <sys/stat.h>
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
#endif
int hc_clock(clockid_t, struct timespec *);
int hc_close(int);
int hc_uid(uid_t *, uid_t *, uid_t *);
int hc_gid(gid_t *, gid_t *, gid_t *);
pid_t hc_pid(void);
pid_t hc_tid(void);
gid_t hc_getgid(void);
int hc_pin(pid_t);
ssize_t hc_fattrs(int, char *, size_t);
ssize_t hc_attrs(const char *, char *, size_t);
int hc_fcntl(int, int, ...);
int hc_fstat(int, struct stat *);
int hc_fstatat(int, const char *, struct stat *, int);
int hc_openat(int, const char *, int, ...);
int hc_poll(struct pollfd *, nfds_t, int);
int hc_getsockopt(int, int, int, void *, socklen_t *);
int hc_socket(int, int, int);
int hc_connect(int, const struct sockaddr *, socklen_t);
int hc_setsockopt(int, int, int, const void *, socklen_t);
ssize_t hc_send(int, const void *, size_t, int);
ssize_t hc_recvmsg(int, struct msghdr *, int);
int hc_shutdown(int, int);
#define HC_TID() hc_tid()
#define HC_PIN_OPEN(pid) hc_pin(pid)
#define clock_gettime hc_clock
#define close hc_close
#define getresuid hc_uid
#define getresgid hc_gid
#define getpid hc_pid
#define getgid hc_getgid
#define flistxattr hc_fattrs
#define listxattr hc_attrs
#define fcntl hc_fcntl
#define fstat hc_fstat
#define fstatat hc_fstatat
#define openat hc_openat
#define poll hc_poll
#define getsockopt hc_getsockopt
#define socket hc_socket
#define connect hc_connect
#define setsockopt hc_setsockopt
#define send hc_send
#define recvmsg hc_recvmsg
#define shutdown hc_shutdown
#endif
