################################################################################
# garden-desk-agent-init
################################################################################

GARDEN_DESK_AGENT_INIT_VERSION = 1
GARDEN_DESK_AGENT_INIT_SITE = $(BR2_EXTERNAL_GARDEN_DESK_PROBE_PATH)/package/garden-desk-agent-init/src
GARDEN_DESK_AGENT_INIT_SITE_METHOD = local
GARDEN_DESK_AGENT_INIT_LICENSE = Apache-2.0

define GARDEN_DESK_AGENT_INIT_BUILD_CMDS
	$(TARGET_CC) $(TARGET_CFLAGS) -std=c17 -Wall -Wextra -Werror \
		-o $(@D)/garden-desk-agent-init $(@D)/garden-desk-agent-init.c
endef

define GARDEN_DESK_AGENT_INIT_INSTALL_TARGET_CMDS
	$(INSTALL) -D -m 0755 $(@D)/garden-desk-agent-init $(TARGET_DIR)/sbin/init
	$(INSTALL) -D -m 0755 $(@D)/garden-desk-agent.py $(TARGET_DIR)/opt/garden-desk/agent.py
	rm -rf $(TARGET_DIR)/usr/lib/python3.14/ensurepip
endef

$(eval $(generic-package))
