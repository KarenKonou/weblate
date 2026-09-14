# Copyright © Michal Čihař <michal@weblate.org>
#
# SPDX-License-Identifier: GPL-3.0-or-later

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("accounts", "0036_deduplicate_totp_devices"),
    ]

    operations = [
        migrations.AddField(
            model_name="profile",
            name="suggestions_in_zen",
            field=models.BooleanField(
                default=True,
                verbose_name="Show suggestions in the Zen mode",
            ),
        ),
    ]
