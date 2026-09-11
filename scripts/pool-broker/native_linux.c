/* Linux v5.15 UAPI syscall tables; each ABI still requires native validation. */
#include "native_api.h"

#if !defined(__linux__) || __BYTE_ORDER__ != __ORDER_LITTLE_ENDIAN__
#error "Only explicitly supported little-endian Linux ABIs may be built"
#endif
_Static_assert(sizeof(long) == 8 && sizeof(void *) == 8, "64-bit ABI required");

#if defined(__x86_64__) && !defined(__ILP32__)
static const long numbers[HD_OP_COUNT] = {118, 120, 332, 436, 319, 91, 1, 72, 292, 3, 59, 231};
#elif defined(__aarch64__)
static const long numbers[HD_OP_COUNT] = {148, 150, 291, 436, 279, 52, 64, 25, 24, 57, 221, 94};
#else
#error "Unverified syscall ABI"
#endif

extern long hd_syscall(long number, long a, long b, long c, long d, long e, long f);

long hd_call(enum hd_op op, long a, long b, long c, long d, long e, long f) {
    if ((unsigned int)op >= HD_OP_COUNT) return -1;
    return hd_syscall(numbers[op], a, b, c, d, e, f);
}
