################################################################################
# garden-desk-node-runtime
################################################################################

GARDEN_DESK_NODE_RUNTIME_VERSION = 24.18.0
ifeq ($(BR2_x86_64),y)
GARDEN_DESK_NODE_RUNTIME_ARCH = x64
else
GARDEN_DESK_NODE_RUNTIME_ARCH = arm64
endif
GARDEN_DESK_NODE_RUNTIME_SOURCE = node-v$(GARDEN_DESK_NODE_RUNTIME_VERSION)-linux-$(GARDEN_DESK_NODE_RUNTIME_ARCH).tar.xz
GARDEN_DESK_NODE_RUNTIME_SITE = https://nodejs.org/download/release/v$(GARDEN_DESK_NODE_RUNTIME_VERSION)
GARDEN_DESK_NODE_RUNTIME_LICENSE = MIT and bundled permissive licenses
GARDEN_DESK_NODE_RUNTIME_LICENSE_FILES = LICENSE

define GARDEN_DESK_NODE_RUNTIME_INSTALL_TARGET_CMDS
	$(INSTALL) -D -m 0755 $(@D)/bin/node $(TARGET_DIR)/usr/bin/node
	$(INSTALL) -D -m 0644 $(@D)/LICENSE $(TARGET_DIR)/usr/share/licenses/node/LICENSE
endef

$(eval $(generic-package))
