#define _GNU_SOURCE

#include <dirent.h>
#include <errno.h>
#include <linux/reboot.h>
#include <linux/vm_sockets.h>
#include <netdb.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <sys/mount.h>
#include <sys/reboot.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <unistd.h>

#define PROBE_PORT 4050U
#define MAX_FRAME_BYTES 1024U

static int read_all(int descriptor, uint8_t *buffer, size_t length) {
  size_t offset = 0;
  while (offset < length) {
    ssize_t count = read(descriptor, buffer + offset, length - offset);
    if (count > 0) {
      offset += (size_t)count;
    } else if (count == 0) {
      return -1;
    } else if (errno != EINTR) {
      return -1;
    }
  }
  return 0;
}
static int write_all(int descriptor, const uint8_t *buffer, size_t length) {
  size_t offset = 0;
  while (offset < length) {
    ssize_t count = write(descriptor, buffer + offset, length - offset);
    if (count > 0) {
      offset += (size_t)count;
    } else if (count < 0 && errno != EINTR) {
      return -1;
    }
  }
  return 0;
}

static uint32_t decode_u32(const uint8_t header[4]) {
  return ((uint32_t)header[0] << 24U) | ((uint32_t)header[1] << 16U) |
         ((uint32_t)header[2] << 8U) | (uint32_t)header[3];
}

static void encode_u32(uint32_t value, uint8_t header[4]) {
  header[0] = (uint8_t)(value >> 24U);
  header[1] = (uint8_t)(value >> 16U);
  header[2] = (uint8_t)(value >> 8U);
  header[3] = (uint8_t)value;
}

static unsigned int non_loopback_interfaces(void) {
  DIR *directory = opendir("/sys/class/net");
  struct dirent *entry;
  unsigned int count = 0;
  if (directory == NULL) return UINT32_MAX;
  while ((entry = readdir(directory)) != NULL) {
    if (strcmp(entry->d_name, ".") != 0 && strcmp(entry->d_name, "..") != 0 &&
        strcmp(entry->d_name, "lo") != 0) {
      count += 1;
    }
  }
  closedir(directory);
  return count;
}

static int open_listener(void) {
  int descriptor = socket(AF_VSOCK, SOCK_STREAM, 0);
  struct sockaddr_vm address = {
      .svm_family = AF_VSOCK,
      .svm_port = PROBE_PORT,
      .svm_cid = VMADDR_CID_ANY,
  };
  if (descriptor < 0) return -1;
  if (bind(descriptor, (struct sockaddr *)&address, sizeof(address)) != 0 ||
      listen(descriptor, 1) != 0) {
    close(descriptor);
    return -1;
  }
  return descriptor;
}

static int receive_probe(int descriptor) {
  static const char expected[] =
      "{\"jobId\":\"00000000-0000-4000-8000-000000000001\","
      "\"operation\":\"probe\",\"protocolVersion\":1,\"requestId\":\"m1-probe\"}";
  uint8_t header[4];
  uint8_t payload[MAX_FRAME_BYTES + 1U];
  if (read_all(descriptor, header, sizeof(header)) != 0) return -1;
  uint32_t length = decode_u32(header);
  if (length == 0 || length > MAX_FRAME_BYTES) return -1;
  if (read_all(descriptor, payload, length) != 0) return -1;
  payload[length] = '\0';
  return strcmp((const char *)payload, expected) == 0 ? 0 : -1;
}

static int send_result(int descriptor, unsigned int interface_count) {
  char payload[MAX_FRAME_BYTES];
  uint8_t header[4];
  struct addrinfo hints = {.ai_family = AF_UNSPEC, .ai_socktype = SOCK_STREAM};
  struct addrinfo *addresses = NULL;
  int dns = getaddrinfo("garden-desk-network-probe.invalid", "443", &hints, &addresses);
  if (addresses != NULL) freeaddrinfo(addresses);
  int ipv4 = socket(AF_INET, SOCK_DGRAM, 0);
  int ipv6 = socket(AF_INET6, SOCK_DGRAM, 0);
  if (ipv4 >= 0) close(ipv4);
  if (ipv6 >= 0) close(ipv6);
  int length = snprintf(
      payload, sizeof(payload),
      "{\"nonLoopbackNetworkDeviceCount\":%u,\"probes\":{\"dnsBlocked\":%s,"
      "\"hostBlocked\":%s,\"ipv4Blocked\":%s,\"ipv6Blocked\":%s,"
      "\"lanBlocked\":%s,\"multicastBlocked\":%s},\"protocolVersion\":1,"
      "\"requestId\":\"m1-probe\",\"status\":\"ok\",\"transport\":\"vsock\"}",
      interface_count, dns != 0 ? "true" : "false", ipv4 < 0 ? "true" : "false",
      ipv4 < 0 ? "true" : "false",
      ipv6 < 0 ? "true" : "false", ipv4 < 0 ? "true" : "false",
      ipv4 < 0 ? "true" : "false");
  if (length <= 0 || (size_t)length >= sizeof(payload)) return -1;
  encode_u32((uint32_t)length, header);
  if (write_all(descriptor, header, sizeof(header)) != 0) return -1;
  return write_all(descriptor, (const uint8_t *)payload, (size_t)length);
}

static void power_off(int status) {
  sync();
  sleep(1);
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
  unsigned int interface_count = non_loopback_interfaces();
  int listener = open_listener();
  if (interface_count == UINT32_MAX || listener < 0) power_off(11);
  int connection = accept(listener, NULL, NULL);
  if (connection < 0 || receive_probe(connection) != 0 ||
      send_result(connection, interface_count) != 0) {
    power_off(12);
  }
  close(connection);
  close(listener);
  power_off(interface_count == 0 ? 0 : 13);
}
