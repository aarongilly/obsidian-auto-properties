module.exports = {
	preset: 'ts-jest',
	testEnvironment: 'node',
	testMatch: ['**/test/**/*.test.ts'],
	moduleFileExtensions: ['ts', 'tsx', 'js', 'mjs', 'cjs', 'jsx', 'json', 'node'],
	moduleNameMapper: {
		'^obsidian$': '<rootDir>/test/__mocks__/obsidian.ts',
	},
	transform: {
		'^.+\\.ts$': ['ts-jest', {
			tsconfig: { module: 'CommonJS', moduleResolution: 'node10' },
		}],
	},
}
