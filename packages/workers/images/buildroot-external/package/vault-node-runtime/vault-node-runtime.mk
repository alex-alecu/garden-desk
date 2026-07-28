################################################################################
# vault-node-runtime
################################################################################

VAULT_NODE_RUNTIME_VERSION = 24.18.0
ifeq ($(BR2_x86_64),y)
VAULT_NODE_RUNTIME_ARCH = x64
else
VAULT_NODE_RUNTIME_ARCH = arm64
endif
VAULT_NODE_RUNTIME_SOURCE = node-v$(VAULT_NODE_RUNTIME_VERSION)-linux-$(VAULT_NODE_RUNTIME_ARCH).tar.xz
VAULT_NODE_RUNTIME_SITE = https://nodejs.org/download/release/v$(VAULT_NODE_RUNTIME_VERSION)
VAULT_NODE_RUNTIME_LICENSE = MIT and bundled permissive licenses
VAULT_NODE_RUNTIME_LICENSE_FILES = LICENSE

define VAULT_NODE_RUNTIME_INSTALL_TARGET_CMDS
	$(INSTALL) -D -m 0755 $(@D)/bin/node $(TARGET_DIR)/usr/bin/node
	$(INSTALL) -D -m 0644 $(@D)/LICENSE $(TARGET_DIR)/usr/share/licenses/node/LICENSE
endef

$(eval $(generic-package))
