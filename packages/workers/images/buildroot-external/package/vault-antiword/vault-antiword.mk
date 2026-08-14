################################################################################
# vault-antiword
################################################################################

VAULT_ANTIWORD_VERSION = 0.37
VAULT_ANTIWORD_DEBIAN_VERSION = 0.37-17
VAULT_ANTIWORD_SOURCE = antiword_$(VAULT_ANTIWORD_VERSION).orig.tar.gz
VAULT_ANTIWORD_SITE = https://deb.debian.org/debian/pool/main/a/antiword
VAULT_ANTIWORD_EXTRA_DOWNLOADS = \
	$(VAULT_ANTIWORD_SITE)/antiword_$(VAULT_ANTIWORD_DEBIAN_VERSION).debian.tar.xz
VAULT_ANTIWORD_LICENSE = GPL-2.0-or-later
VAULT_ANTIWORD_LICENSE_FILES = Docs/COPYING

define VAULT_ANTIWORD_EXTRACT_DEBIAN_PATCHES
	mkdir -p $(@D)/.debian
	$(TAR) -xf $(VAULT_ANTIWORD_DL_DIR)/antiword_$(VAULT_ANTIWORD_DEBIAN_VERSION).debian.tar.xz \
		-C $(@D)/.debian
endef
VAULT_ANTIWORD_POST_EXTRACT_HOOKS += VAULT_ANTIWORD_EXTRACT_DEBIAN_PATCHES

define VAULT_ANTIWORD_APPLY_DEBIAN_PATCHES
	$(APPLY_PATCHES) $(@D) $(@D)/.debian/debian/patches
endef
VAULT_ANTIWORD_PRE_PATCH_HOOKS += VAULT_ANTIWORD_APPLY_DEBIAN_PATCHES

define VAULT_ANTIWORD_BUILD_CMDS
	$(TARGET_MAKE_ENV) $(MAKE) -C $(@D) -f Makefile.Linux \
		CC="$(TARGET_CC)" LD="$(TARGET_CC)" \
		CFLAGS="$(TARGET_CFLAGS) -Wall -pedantic -D_FILE_OFFSET_BITS=64 -DNDEBUG" \
		LDFLAGS="$(TARGET_LDFLAGS)" antiword
endef

define VAULT_ANTIWORD_CHECK_SIZE
	bytes=`wc -c < $(@D)/antiword`; \
	bytes=$$((bytes + `wc -c < $(@D)/Resources/UTF-8.txt`)); \
	bytes=$$((bytes + `wc -c < $(@D)/Resources/fontnames`)); \
	test $$bytes -le 1048576
endef

define VAULT_ANTIWORD_INSTALL_TARGET_CMDS
	$(VAULT_ANTIWORD_CHECK_SIZE)
	$(INSTALL) -D -m 0755 $(@D)/antiword $(TARGET_DIR)/usr/bin/antiword
	$(INSTALL) -D -m 0644 $(@D)/Resources/UTF-8.txt \
		$(TARGET_DIR)/usr/share/antiword/UTF-8.txt
	$(INSTALL) -D -m 0644 $(@D)/Resources/fontnames \
		$(TARGET_DIR)/usr/share/antiword/fontnames
	$(INSTALL) -D -m 0644 $(@D)/Docs/COPYING \
		$(TARGET_DIR)/usr/share/licenses/antiword/COPYING
endef

$(eval $(generic-package))
