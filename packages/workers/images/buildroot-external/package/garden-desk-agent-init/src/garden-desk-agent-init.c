#define _GNU_SOURCE

#include <errno.h>
#include <linux/reboot.h>
#include <stdio.h>
#include <sys/mount.h>
#include <sys/reboot.h>
#include <sys/stat.h>
#include <unistd.h>

static void power_off(int status) {
  sync();
  reboot(LINUX_REBOOT_CMD_POWER_OFF);
  _exit(status);
}

int main(void) {
  mkdir("/proc", 0555);
  mkdir("/sys", 0555);
  if (mount("proc", "/proc", "proc", 0, NULL) != 0 ||
      mount("sysfs", "/sys", "sysfs", 0, NULL) != 0) {
    power_off(10);
  }
  execl("/usr/bin/python3", "python3", "/opt/garden-desk/agent.py", NULL);
  fprintf(stderr, "agent init failed: %d\n", errno);
  power_off(11);
}
