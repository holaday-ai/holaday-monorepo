#ifndef HOLADAY_NATIVE_API_H
#define HOLADAY_NATIVE_API_H

/* Semantic syscall boundary: production mapping is in native_linux.c. */
enum hd_op { HD_UIDS, HD_GIDS, HD_STATX, HD_CLOSE_RANGE, HD_MEMFD, HD_CHMOD,
             HD_WRITE, HD_FCNTL, HD_DUP3, HD_CLOSE, HD_EXEC, HD_EXIT, HD_OP_COUNT };
long hd_call(enum hd_op op, long a, long b, long c, long d, long e, long f);
void hd_start(unsigned long *stack);

#endif
