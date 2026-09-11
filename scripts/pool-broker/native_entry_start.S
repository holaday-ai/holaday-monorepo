/* No CRT: kernel initial stack -> hd_start, fixed Linux syscall bridge. */
#if !defined(__linux__)
#error "Linux entry only"
#endif
.text
.global _start
.global hd_syscall
#if defined(__x86_64__) && !defined(__ILP32__)
.type _start,@function
_start:
    xor %ebp,%ebp
    mov %rsp,%rdi
    and $-16,%rsp
    call hd_start
    ud2
.size _start,.-_start
.type hd_syscall,@function
hd_syscall:
    mov %rdi,%rax
    mov %rsi,%rdi
    mov %rdx,%rsi
    mov %rcx,%rdx
    mov %r8,%r10
    mov %r9,%r8
    mov 8(%rsp),%r9
    syscall
    ret
.size hd_syscall,.-hd_syscall
#elif defined(__aarch64__)
.type _start,%function
_start:
    mov x29,xzr
    mov x30,xzr
    mov x0,sp
    bl hd_start
    brk #0
.size _start,.-_start
.type hd_syscall,%function
hd_syscall:
    mov x8,x0
    mov x0,x1
    mov x1,x2
    mov x2,x3
    mov x3,x4
    mov x4,x5
    mov x5,x6
    svc #0
    ret
.size hd_syscall,.-hd_syscall
#else
#error "Unsupported Linux ABI"
#endif
.section .note.GNU-stack,"",%progbits
