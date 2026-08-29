export type ImplingType = 'gourmet' | 'magpie' | 'dragon';

// Values collected by the Swing UI and used by the game-loop module.
export type AutoDarkLureUiState = {
	uiCompleted: boolean;
	gameTick: number;
	gourmet: boolean;
	magpie: boolean;
	dragon: boolean;
	searchRange: number;
};

// Default UI values, replaced with saved values whenever the script starts.
const uiState: AutoDarkLureUiState = {
	uiCompleted: false,
	gameTick: 0,
	gourmet: true,
	magpie: true,
	dragon: true,
	searchRange: 10,
};

// bmCache keys persist settings between script runs.
const GOURMET_CACHE_KEY = 'autoDarklure.settings.gourmet';
const MAGPIE_CACHE_KEY = 'autoDarklure.settings.magpie';
const DRAGON_CACHE_KEY = 'autoDarklure.settings.dragon';
const SEARCH_RANGE_CACHE_KEY = 'autoDarklure.settings.searchRange';

// Keep a reference so the window can be closed when starting or ending a run.
let startFrame: javax.swing.JFrame | null = null;

// Close the existing UI window safely, if one is open.
const disposeStartFrame = (): void => {
	if (!startFrame) {
		return;
	}
	startFrame.dispose();
	startFrame = null;
};

// The game loop uses this to wait for the Start Script button.
export const isUiCompleted = (): boolean => uiState.uiCompleted;

// Expose the chosen maximum targeting distance to the main script.
export const getSearchRange = (): number => uiState.searchRange;

// Return the impling categories currently enabled by the user.
export const getSelectedImplingTypes = (): ImplingType[] => {
	const selected: ImplingType[] = [];
	if (uiState.gourmet) selected.push('gourmet');
	if (uiState.magpie) selected.push('magpie');
	if (uiState.dragon) selected.push('dragon');
	return selected;
};

// Build the Java Swing window shown before the automation begins.
const createStartFrame = (): javax.swing.JFrame => {
	const frame = new javax.swing.JFrame('Auto DarkLure');
	frame.setDefaultCloseOperation(
		javax.swing.WindowConstants.DISPOSE_ON_CLOSE,
	);
	frame.setLayout(new java.awt.BorderLayout(10, 10));

	const mainPanel = new javax.swing.JPanel(new java.awt.BorderLayout(10, 10));
	mainPanel.setBorder(
		javax.swing.BorderFactory.createEmptyBorder(12, 12, 12, 12),
	);

	const titlePanel = new javax.swing.JPanel();
	titlePanel.setLayout(new java.awt.FlowLayout(java.awt.FlowLayout.CENTER));
	const titleLabel = new javax.swing.JLabel('Auto DarkLure');
	titleLabel.setFont(new java.awt.Font('SansSerif', java.awt.Font.BOLD, 18));
	titlePanel.add(titleLabel);

	const checkboxPanel = new javax.swing.JPanel();
	checkboxPanel.setLayout(
		new javax.swing.BoxLayout(checkboxPanel, javax.swing.BoxLayout.Y_AXIS),
	);

	const gourmetCheckbox = new javax.swing.JCheckBox(
		'Gourmet Impling',
		uiState.gourmet,
	);
	const magpieCheckbox = new javax.swing.JCheckBox(
		'Magpie Impling',
		uiState.magpie,
	);
	const dragonCheckbox = new javax.swing.JCheckBox(
		'Dragon Impling',
		uiState.dragon,
	);

	// The checkboxes let the user choose which impling families may be targeted.
	checkboxPanel.add(gourmetCheckbox);
	checkboxPanel.add(magpieCheckbox);
	checkboxPanel.add(dragonCheckbox);

	const rangePanel = new javax.swing.JPanel(
		new java.awt.FlowLayout(java.awt.FlowLayout.LEFT),
	);
	const rangeLabel = new javax.swing.JLabel(
		`Search range: ${uiState.searchRange} tiles`,
	);
	const rangeSlider = new javax.swing.JSlider(0, 5, 20, uiState.searchRange);
	// Configure one-tile steps with labels at five-tile intervals.
	rangeSlider.setMajorTickSpacing(5);
	rangeSlider.setMinorTickSpacing(1);
	rangeSlider.setPaintTicks(true);
	rangeSlider.setPaintLabels(true);
	rangeSlider.setSnapToTicks(true);
	// Reflect slider movement immediately so the selected distance is visible.
	rangeSlider.addChangeListener(() => {
		rangeLabel.setText(`Search range: ${rangeSlider.getValue()} tiles`);
	});
	rangePanel.add(rangeLabel);
	rangePanel.add(rangeSlider);
	checkboxPanel.add(rangePanel);

	const buttonPanel = new javax.swing.JPanel(
		new java.awt.FlowLayout(java.awt.FlowLayout.CENTER),
	);
	const startButton = new javax.swing.JButton('Start Script');
	startButton.addActionListener(() => {
		// Copy the UI controls into script state before closing the window.
		uiState.gourmet = gourmetCheckbox.isSelected();
		uiState.magpie = magpieCheckbox.isSelected();
		uiState.dragon = dragonCheckbox.isSelected();
		uiState.searchRange = rangeSlider.getValue();

		// Save every setting so the next run opens with the same choices.
		bot.bmCache.saveBoolean(GOURMET_CACHE_KEY, uiState.gourmet);
		bot.bmCache.saveBoolean(MAGPIE_CACHE_KEY, uiState.magpie);
		bot.bmCache.saveBoolean(DRAGON_CACHE_KEY, uiState.dragon);
		bot.bmCache.saveInt(SEARCH_RANGE_CACHE_KEY, uiState.searchRange);

		// Release the game loop and remove the setup UI.
		uiState.uiCompleted = true;
		log.print('[AutoDarkLure] UI completed. Starting script logic.');
		disposeStartFrame();
	});
	buttonPanel.add(startButton);

	mainPanel.add(titlePanel, java.awt.BorderLayout.NORTH);
	mainPanel.add(checkboxPanel, java.awt.BorderLayout.CENTER);
	mainPanel.add(buttonPanel, java.awt.BorderLayout.SOUTH);
	frame.add(mainPanel, java.awt.BorderLayout.CENTER);
	frame.pack();
	frame.setLocationRelativeTo(null);
	return frame;
};

// BotMaker calls this on script startup; load settings and show the setup window.
export function onStart(): void {
	uiState.gameTick = 0;
	uiState.uiCompleted = false;
	uiState.gourmet = bot.bmCache.getBoolean(GOURMET_CACHE_KEY, true);
	uiState.magpie = bot.bmCache.getBoolean(MAGPIE_CACHE_KEY, true);
	uiState.dragon = bot.bmCache.getBoolean(DRAGON_CACHE_KEY, true);
	// Clamp saved values so an invalid cache value cannot break the slider.
	uiState.searchRange = Math.min(
		20,
		Math.max(5, bot.bmCache.getInt(SEARCH_RANGE_CACHE_KEY, 10)),
	);

	disposeStartFrame();
	startFrame = createStartFrame();
	startFrame.setVisible(true);
	log.print('[AutoDarkLure] Script started. Waiting for UI input.');
}

// Retained as a BotMaker lifecycle hook; the main module owns game actions.
export function onGameTick(): void {
	const player: net.runelite.api.Player | null = client.getLocalPlayer();
	if (!player) return;

	uiState.gameTick += 1;
	if (!uiState.uiCompleted) return;
}

// Close the setup window if the user stops the script before or after starting.
export function onEnd(): void {
	disposeStartFrame();
	log.print('[AutoDarkLure] Script ended.');
}
