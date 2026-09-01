################################################################################
# garden-desk-antiword
################################################################################

GARDEN_DESK_ANTIWORD_VERSION = 0.37
GARDEN_DESK_ANTIWORD_DEBIAN_VERSION = 0.37-17
GARDEN_DESK_ANTIWORD_SOURCE = antiword_$(GARDEN_DESK_ANTIWORD_VERSION).orig.tar.gz
GARDEN_DESK_ANTIWORD_SITE = https://deb.debian.org/debian/pool/main/a/antiword
GARDEN_DESK_ANTIWORD_EXTRA_DOWNLOADS = \
	$(GARDEN_DESK_ANTIWORD_SITE)/antiword_$(GARDEN_DESK_ANTIWORD_DEBIAN_VERSION).debian.tar.xz
GARDEN_DESK_ANTIWORD_LICENSE = GPL-2.0-or-later
GARDEN_DESK_ANTIWORD_LICENSE_FILES = Docs/COPYING

define GARDEN_DESK_ANTIWORD_EXTRACT_DEBIAN_PATCHES
	mkdir -p $(@D)/.debian
	$(TAR) -xf $(GARDEN_DESK_ANTIWORD_DL_DIR)/antiword_$(GARDEN_DESK_ANTIWORD_DEBIAN_VERSION).debian.tar.xz \
		-C $(@D)/.debian
endef
GARDEN_DESK_ANTIWORD_POST_EXTRACT_HOOKS += GARDEN_DESK_ANTIWORD_EXTRACT_DEBIAN_PATCHES

define GARDEN_DESK_ANTIWORD_APPLY_DEBIAN_PATCHES
	$(APPLY_PATCHES) $(@D) $(@D)/.debian/debian/patches
endef
GARDEN_DESK_ANTIWORD_PRE_PATCH_HOOKS += GARDEN_DESK_ANTIWORD_APPLY_DEBIAN_PATCHES

define GARDEN_DESK_ANTIWORD_BUILD_CMDS
	$(TARGET_MAKE_ENV) $(MAKE) -C $(@D) -f Makefile.Linux \
		CC="$(TARGET_CC)" LD="$(TARGET_CC)" \
		CFLAGS="$(TARGET_CFLAGS) -Wall -pedantic -D_FILE_OFFSET_BITS=64 -DNDEBUG" \
		LDFLAGS="$(TARGET_LDFLAGS)" antiword
endef

define GARDEN_DESK_ANTIWORD_CHECK_SIZE
	bytes=`wc -c < $(@D)/antiword`; \
	bytes=$$((bytes + `wc -c < $(@D)/Resources/UTF-8.txt`)); \
	bytes=$$((bytes + `wc -c < $(@D)/Resources/fontnames`)); \
	test $$bytes -le 1048576
endef

define GARDEN_DESK_ANTIWORD_INSTALL_TARGET_CMDS
	$(GARDEN_DESK_ANTIWORD_CHECK_SIZE)
	$(INSTALL) -D -m 0755 $(@D)/antiword $(TARGET_DIR)/usr/bin/antiword
	$(INSTALL) -D -m 0644 $(@D)/Resources/UTF-8.txt \
		$(TARGET_DIR)/usr/share/antiword/UTF-8.txt
	$(INSTALL) -D -m 0644 $(@D)/Resources/fontnames \
		$(TARGET_DIR)/usr/share/antiword/fontnames
	$(INSTALL) -D -m 0644 $(@D)/Docs/COPYING \
		$(TARGET_DIR)/usr/share/licenses/antiword/COPYING
endef

$(eval $(generic-package))
