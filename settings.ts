import { App, Notice, PluginSettingTab, Setting, TFile } from "obsidian";
import AutoPropertyPlugin from "./main";

/*
// export interface AutoPropertyPluginSettings {
// 	mySetting: string;
// }

// export const DEFAULT_SETTINGS: AutoPropertyPluginSettings = {
// 	mySetting: 'default'
// }

// export class SampleSettingTab extends PluginSettingTab {
// 	plugin: AutoPropertyPlugin;

// 	constructor(app: App, plugin: AutoPropertyPlugin) {
// 		super(app, plugin);
// 		this.plugin = plugin;
// 	}

// 	display(): void {
// 		const {containerEl} = this;

// 		containerEl.empty();

// 		new Setting(containerEl)
// 			.setName('Settings #1')
// 			.setDesc('It\'s a secret')
// 			.addText(text => text
// 				.setPlaceholder('Enter your secret')
// 				.setValue(this.plugin.settings.mySetting)
// 				.onChange(async (value) => {
// 					this.plugin.settings.mySetting = value;
// 					await this.plugin.saveSettings();
// 				}));
// 	}
// }
*/

export interface AutoPropertyPluginSettings {
    autopropertySettings: AutoPropertySetting[];
}

export interface AutoPropertySetting {
    key: string;
    enabled: boolean;
    rulePartOne: 'first' | 'all' | 'count';
    rulePartTwo: 'startsWith' | 'contains' | 'endsWith'; // | 'regex';
    ruleValue: string;
    rulePartThree: 'trim' | 'noTrim';
}

export const DEFAULT_SETTINGS: AutoPropertyPluginSettings = {
    autopropertySettings: []
}

export class SampleSettingTab extends PluginSettingTab {
    plugin: AutoPropertyPlugin;

    constructor(app: App, plugin: AutoPropertyPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;

        containerEl.empty();

        new Setting(containerEl).setDesc("DEVELOPMENT PURPOSES").addButton(button => {
            button.setButtonText("LOG SETTINGS");
            button.onClick(async () => {
                console.log(this.plugin.settings.autopropertySettings);
            });
        });

        new Setting(containerEl).setName("Update all notes").setDesc("Properties auto-update each time a note changes, but if you want to update all notes at once you can click this button.").addButton(button => {
            button.setButtonText("Update all");
            button.onClick(async () => {
                new Notice("#TODO")
                console.log(this.plugin.settings.autopropertySettings);
            });
        });

        let ruleHeading = document.createElement("h2");
        ruleHeading.innerText = "Auto-Properties";
        ruleHeading.addClass('my-head');
        containerEl.appendChild(ruleHeading)

        this.plugin.settings.autopropertySettings.forEach((autoProp, index) => {
            containerEl.appendChild(this.createAutoPropertyPanel(autoProp, index));
        });

        const addButton = document.createElement("button");
        addButton.setText("Add Auto-Property");
        addButton.addClass('my-button');
        addButton.onclick = async () => {
            this.plugin.settings.autopropertySettings.push({
                key: "",
                enabled: true,
                rulePartOne: 'first',
                rulePartTwo: 'startsWith',
                ruleValue: '',
                rulePartThree: 'noTrim'
            });
            await this.plugin.saveSettings();
            this.display(); // Refresh the settings tab to show the new property
        }
        containerEl.appendChild(addButton);
    }

    createAutoPropertyPanel(autoProp: AutoPropertySetting, index: number): HTMLElement {
        let wipAutoProp = {
            key: autoProp.key,
            enabled: autoProp.enabled,
            rulePartOne: autoProp.rulePartOne,
            rulePartTwo: autoProp.rulePartTwo,
            ruleValue: autoProp.ruleValue,
            rulePartThree: autoProp.rulePartThree
        }
        const panel = document.createElement("div");
        panel.addClass('property-panel');

        //this is used later, but declared here for scoping
        const saveButton = document.createElement("button");
        updateSaveButtonStatus();

        new Setting(panel).setName("Key").addText(text => text.setValue(autoProp.key).setPlaceholder("Enter key").onChange(async (value) => {
            wipAutoProp.key = value;
            updateSaveButtonStatus();
        })).setDesc("The property key to run the rule against.");
        new Setting(panel).setName("Rule")
            .addDropdown(dropdown => {
                dropdown.addOption("first", "Pull the first line which");
                dropdown.addOption("all", "Pull all lines which");
                dropdown.addOption("count", "Count of each line that");
                dropdown.setValue(wipAutoProp.rulePartOne).onChange(async (value) => {
                    wipAutoProp.rulePartOne = value as 'first' | 'all' | 'count';
                    updateSaveButtonStatus();
                })
            })
            .addDropdown(dropdown => {
                dropdown.addOption("startsWith", "starts with");
                dropdown.addOption("contains", "contains");
                dropdown.addOption("endsWith", "ends with");
                // dropdown.addOption("regex", "matches regex"); #TODO - implement regex handling
                dropdown.setValue(wipAutoProp.rulePartTwo).onChange(async (value) => {
                    wipAutoProp.rulePartTwo = value as 'startsWith' | 'contains' | 'endsWith';
                    updateSaveButtonStatus();
                });
            }).addText(text => text.setPlaceholder("Enter value for the rule").setValue(autoProp.ruleValue).onChange(async (value) => {
                wipAutoProp.ruleValue = value;
                updateSaveButtonStatus();
            }))

        new Setting(panel).setName("Whitespace").setDesc("Choose whether to trim whitespace from matched lines.")
            .addDropdown(dropdown => {
                dropdown.addOption("trim", "ignoring whitespace");
                dropdown.addOption("noTrim", "including whitespace");
                dropdown.setValue(wipAutoProp.rulePartThree).onChange(async (value) => {
                    wipAutoProp.rulePartThree = value as 'trim' | 'noTrim';
                });
            })

        new Setting(panel).setName("Enabled").addToggle(toggle => toggle.setValue(autoProp.enabled).onChange(async (value) => {
            wipAutoProp.enabled = value;
            updateSaveButtonStatus();
        }));

        const buttonContainer = document.createElement("div");
        buttonContainer.addClass('button-container');
        buttonContainer.style.display = 'grid';
        buttonContainer.style.gap = '8px';
        buttonContainer.style.gridTemplateColumns = '1fr 1fr';

        saveButton.setText("Saved");
        saveButton.onclick = async () => {
            if (!wipAutoProp.key.trim()) {
                new Notice("Key cannot be blank");
                return;
            }
            if (!wipAutoProp.ruleValue.trim()) {
                new Notice("Rule value cannot be blank");
                return;
            }
            Object.assign(autoProp, wipAutoProp);
            await this.plugin.saveSettings();
            saveButton.setText("Saved");
            new Notice("Auto-Property saved");
        };
        buttonContainer.appendChild(saveButton);

        const deleteButton = document.createElement("button");
        deleteButton.setText("Delete");
        deleteButton.addClass('mod-warning');
        deleteButton.onclick = async () => {
            this.plugin.settings.autopropertySettings.splice(index, 1);
            await this.plugin.saveSettings();
            this.display();
        };
        buttonContainer.appendChild(deleteButton);

        panel.appendChild(buttonContainer);

        // Key setting
        return panel;

        function updateSaveButtonStatus() {
            if (wipAutoProp.key.trim() && wipAutoProp.ruleValue.trim()) {
                saveButton.removeAttribute("disabled");
                saveButton.removeClass('mod-disabled');
                saveButton.setText("Save!");
            } else {
                saveButton.setAttribute("disabled", "true");
                saveButton.addClass('mod-disabled');
            }
        }
    }
}