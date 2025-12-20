import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import AutoPropertyPlugin from "./main";

export interface AutoPropertyPluginSettings {
    autopropertySettings: AutoPropRule[];
    manualMode: boolean
}

export interface AutoPropRule {
    key: string;
    enabled: boolean;
    rulePartOne: 'first' | 'all' | 'count';
    rulePartTwo: 'startsWith' | 'contains' | 'endsWith' | 'regex';
    ruleValue: string;
    modifierWhitespace: 'trim' | 'noTrim';
    modifierOmitSearch: 'none' | 'omit';
    modifierCaseSensitive: 'sensitive' | 'insensitive'
}

export const DEFAULT_SETTINGS: AutoPropertyPluginSettings = {
    autopropertySettings: [],
    manualMode: false
}

export class AutoPropertiesSettingsTab extends PluginSettingTab {
    plugin: AutoPropertyPlugin;

    constructor(app: App, plugin: AutoPropertyPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;

        containerEl.empty();

        new Setting(containerEl).setName("Update all notes").setDesc("Properties auto-update each time a note changes, but if you want to update all notes at once you can click this button.").addButton(button => {
            button.setButtonText("Update all");
            button.onClick(() => {
                this.plugin.updateAllNotes()
                new Notice("Updated all auto-property values in vault")
            });
        });

        new Setting(containerEl).setName("Manual mode").setDesc("Disable 'run on file modification' feature.")
            .addToggle(toggle => {
                toggle.setValue(this.plugin.settings.manualMode).onChange(async (value) => {
                    this.plugin.settings.manualMode = value;
                    await this.plugin.saveSettings();
                });
            });


        let propertiesHeading = document.createElement("h2");
        propertiesHeading.innerText = "Auto-properties";
        propertiesHeading.addClass('my-head');
        containerEl.appendChild(propertiesHeading)

        this.plugin.settings.autopropertySettings.forEach((autoProp, index) => {
            // Inflate a panel for each auto-property registered in the settings
            containerEl.appendChild(this.createAutoPropertyPanel(autoProp, index));
        });

        // button to create a new blank auto-property
        const addButton = document.createElement("button");
        addButton.setText("Add Auto-property");
        addButton.addClass('my-button');
        addButton.onclick = async () => {
            this.plugin.settings.autopropertySettings.push({
                key: "",
                enabled: true,
                rulePartOne: 'first',
                rulePartTwo: 'startsWith',
                ruleValue: '',
                modifierWhitespace: 'trim',
                modifierOmitSearch: 'none',
                modifierCaseSensitive: 'insensitive'
            });
            await this.plugin.saveSettings();
            this.display(); // Refresh the settings tab to show the new property
        }
        containerEl.appendChild(addButton);
    }

    createAutoPropertyPanel(autoProp: AutoPropRule, index: number): HTMLElement {
        let wipAutoProp = {
            key: autoProp.key,
            enabled: autoProp.enabled,
            rulePartOne: autoProp.rulePartOne,
            rulePartTwo: autoProp.rulePartTwo,
            ruleValue: autoProp.ruleValue,
            modifierWhitespace: autoProp.modifierWhitespace,
            modifierOmitSearch: autoProp.modifierOmitSearch,
            modifierCaseSensitive: autoProp.modifierCaseSensitive
        }
        const panel = document.createElement("div");
        panel.addClass('property-panel');

        const header = document.createElement("h3");
        header.addClasses(["key-header", "clickable"]);
        header.setCssProps({ "margin-bottom": "0px" })
        header.innerText = `${autoProp.key || "(no key set)"}`;
        panel.appendChild(header);

        const summary = document.createElement("span")
        let headerSummary = makeSummaryText(autoProp);
        summary.innerText = headerSummary;
        if (header.innerText === "(no key set)") summary.innerText = "- auto-property not configured";
        summary.addClasses(['italic', 'clickable'])
        panel.appendChild(summary);

        const container = document.createElement("div");
        panel.appendChild(container);
        if (header.innerText !== "(no key set)") container.setCssProps({ 'display': 'none' })

        function toggleContainer() {
            if (container.style.display === 'none') {
                container.setCssProps({ 'display': 'block' });
                summary.setCssProps({ 'display': 'none' });
            } else {
                container.setCssProps({ 'display': 'none' });
                summary.setCssProps({ 'display': 'inline-block' });
            }
        }
        header.onclick = toggleContainer
        summary.onclick = toggleContainer

        //this is used later, but declared here for scoping
        const saveButton = document.createElement("button");
        updateSaveButtonStatus();

        new Setting(container).setName("Property").addText(text => text.setValue(autoProp.key).setPlaceholder("Enter property name").onChange((value) => {
            wipAutoProp.key = value;
            updateSaveButtonStatus();
        })).setDesc("The name (key) of the property to run the rule against.").setClass('setting-key');
        new Setting(container).setName("Rule")
            .addDropdown(dropdown => {
                dropdown.addOption("first", "Pull the first line");
                dropdown.addOption("all", "Pull all lines");
                dropdown.addOption("count", "Count the lines");
                dropdown.setValue(wipAutoProp.rulePartOne).onChange((value) => {
                    wipAutoProp.rulePartOne = value as 'first' | 'all' | 'count';
                    updateSaveButtonStatus();
                })
            })
            .addDropdown(dropdown => {
                dropdown.addOption("startsWith", "starting with");
                dropdown.addOption("contains", "containing");
                dropdown.addOption("endsWith", "ending with");
                dropdown.addOption("regex", "matching regex");
                dropdown.setValue(wipAutoProp.rulePartTwo).onChange((value) => {
                    wipAutoProp.rulePartTwo = value as 'startsWith' | 'contains' | 'endsWith' | 'regex';
                    updateSaveButtonStatus();
                });
            }).addText(text => text.setPlaceholder("Enter value for the rule").setValue(autoProp.ruleValue).onChange((value) => {
                wipAutoProp.ruleValue = value;
                // If regex expressions include the "\", remove them
                if (value.startsWith(`\\`) && value.endsWith(`\\`)) {
                    wipAutoProp.ruleValue = value.slice(1, -1);
                }
                updateSaveButtonStatus();
            }))


        const modifiersSetting = new Setting(container).setName("Modifiers")

        const modifierContainer = document.createElement("div");
        modifiersSetting.controlEl.appendChild(modifierContainer)

        new Setting(modifierContainer).setName("Ignore whitespace")
            .addToggle(toggle => {
                toggle.setValue(wipAutoProp.modifierWhitespace == 'trim').onChange((value) => {
                    if (value) {
                        wipAutoProp.modifierWhitespace = 'trim';
                    } else {
                        wipAutoProp.modifierWhitespace = 'noTrim';
                    }
                });
            })

        new Setting(modifierContainer).setName("Omit search string from result text")
            .addToggle(toggle => {
                toggle.setValue(wipAutoProp.modifierOmitSearch == 'omit').onChange((value) => {
                    if (value) {
                        wipAutoProp.modifierOmitSearch = 'omit';
                    } else {
                        wipAutoProp.modifierOmitSearch = 'none';
                    }
                });
            })

        new Setting(modifierContainer).setName("Case sensitive")
            .addToggle(toggle => {
                toggle.setValue(wipAutoProp.modifierCaseSensitive == 'sensitive').onChange((value) => {
                    if (value) {
                        wipAutoProp.modifierCaseSensitive = 'sensitive';
                    } else {
                        wipAutoProp.modifierCaseSensitive = 'insensitive';
                    }
                });
            })

        new Setting(container).setName("Enabled").addToggle(toggle => toggle.setValue(autoProp.enabled).onChange((value) => {
            wipAutoProp.enabled = value;
            updateSaveButtonStatus();
        }));

        const buttonContainer = document.createElement("div");
        buttonContainer.addClass('button-container');

        saveButton.setText("Save");
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
            this.display();
            new Notice("Auto-property saved");
        };
        buttonContainer.appendChild(saveButton);

        const deleteButton = document.createElement("button");
        deleteButton.setText("Delete");
        deleteButton.addClasses(['mod-warning', 'clickable']);
        deleteButton.onclick = async () => {
            this.plugin.settings.autopropertySettings.splice(index, 1);
            await this.plugin.saveSettings();
            this.display();
        };
        buttonContainer.appendChild(deleteButton);
        container.appendChild(buttonContainer);

        // Key setting
        return panel;

        //#region --- Local Helper Functions

        function updateSaveButtonStatus() {
            if (wipAutoProp.key.trim() && wipAutoProp.ruleValue.trim()) {
                saveButton.removeAttribute("disabled");
                saveButton.removeClass('mod-disabled');
                saveButton.addClass('clickable')
                saveButton.setText("Save!");
            } else {
                saveButton.setAttribute("disabled", "true");
                saveButton.addClass('mod-disabled');
                saveButton.removeClass('clickable')
            }
        }

        function makeSummaryText(prop: AutoPropRule): string {
            const rulePartOneText = {
                first: "Pull the first line",
                all: "Pull all lines",
                count: "Count the lines"
            };

            const rulePartTwoText = {
                startsWith: "starting with",
                contains: "containing",
                endsWith: "ending with",
                regex: "matching regex"
            };

            let text = `${rulePartOneText[prop.rulePartOne]} ${rulePartTwoText[prop.rulePartTwo]} "${prop.ruleValue}"`;
            if (!prop.enabled) text = "- auto-property not enabled";
            return text;
        }

        //#endregion
    }
}