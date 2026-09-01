################################################################################
# garden-desk-probe-init
################################################################################

GARDEN_DESK_PROBE_INIT_VERSION = 1
GARDEN_DESK_PROBE_INIT_SITE = $(BR2_EXTERNAL_GARDEN_DESK_PROBE_PATH)/package/garden-desk-probe-init/src
GARDEN_DESK_PROBE_INIT_SITE_METHOD = local

define GARDEN_DESK_PROBE_INIT_BUILD_CMDS
	$(TARGET_CC) $(TARGET_CFLAGS) -static -std=c17 -Wall -Wextra -Werror \
		-o $(@D)/garden-desk-probe-init $(@D)/garden-desk-probe-init.c
endef

define GARDEN_DESK_PROBE_INIT_INSTALL_TARGET_CMDS
	$(INSTALL) -D -m 0755 $(@D)/garden-desk-probe-init $(TARGET_DIR)/sbin/init
endef

$(eval $(generic-package))
