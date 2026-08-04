################################################################################
# vault-python-libraries
################################################################################

VAULT_PYTHON_LIBRARIES_VERSION = 1
VAULT_PYTHON_LIBRARIES_SOURCE = pypdf-6.14.2-py3-none-any.whl
VAULT_PYTHON_LIBRARIES_SITE = https://files.pythonhosted.org/packages/49/e6/136aa8993a2ae7214e0b0ef2edaa0d2e08d1d4e4982635b08a835ff31ec8
VAULT_PYTHON_LIBRARIES_EXTRA_DOWNLOADS = \
	https://files.pythonhosted.org/packages/c0/da/977ded879c29cbd04de313843e76868e6e13408a94ed6b987245dc7c8506/openpyxl-3.1.5-py2.py3-none-any.whl \
	https://files.pythonhosted.org/packages/c1/8b/5fe2cc11fee489817272089c4203e679c63b570a5aaeb18d852ae3cbba6a/et_xmlfile-2.0.0-py3-none-any.whl \
	https://files.pythonhosted.org/packages/d0/00/1e03a4989fa5795da308cd774f05b704ace555a70f9bf9d3be057b680bcf/python_docx-1.2.0-py3-none-any.whl \
	https://files.pythonhosted.org/packages/a3/07/70085c17a369605f15e301d10ab902115019b1126c7253d964afc230c7d6/reportlab-5.0.0-py3-none-any.whl \
	https://files.pythonhosted.org/packages/98/2b/f97f1c193fb855c345d678f5077d6926034db0722df74c8f057020e05a25/charset_normalizer-3.4.9-py3-none-any.whl
VAULT_PYTHON_LIBRARIES_LICENSE = BSD-3-Clause and MIT and GPL-2.0-or-later-with-font-exception and Bitstream-Vera
VAULT_PYTHON_LIBRARIES_LICENSE_FILES = site/pypdf-6.14.2.dist-info/licenses/LICENSE \
	site/openpyxl-3.1.5.dist-info/LICENCE.rst \
	site/python_docx-1.2.0.dist-info/licenses/LICENSE \
	site/reportlab-5.0.0.dist-info/licenses/LICENSE \
	site/charset_normalizer-3.4.9.dist-info/licenses/LICENSE \
	site/reportlab/fonts/DarkGarden-copying.txt \
	site/reportlab/fonts/DarkGarden-copying-gpl.txt \
	site/reportlab/fonts/bitstream-vera-license.txt

define VAULT_PYTHON_LIBRARIES_EXTRACT_CMDS
	mkdir -p $(@D)/site
	$(foreach wheel,$(VAULT_PYTHON_LIBRARIES_SOURCE) $(notdir $(VAULT_PYTHON_LIBRARIES_EXTRA_DOWNLOADS)), \
		$(HOST_DIR)/bin/python3 -m zipfile -e $(VAULT_PYTHON_LIBRARIES_DL_DIR)/$(wheel) $(@D)/site$(sep))
endef

define VAULT_PYTHON_LIBRARIES_INSTALL_TARGET_CMDS
	mkdir -p $(TARGET_DIR)/usr/lib/python$(PYTHON3_VERSION_MAJOR)/site-packages
	cp -a $(@D)/site/. $(TARGET_DIR)/usr/lib/python$(PYTHON3_VERSION_MAJOR)/site-packages/
endef

$(eval $(generic-package))
