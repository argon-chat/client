# Documentation for Voice Chat Service UI

This documentation provides an overview of the project, its scripts, and configuration options for the front-end interface of the voice chat service.

## Project Overview

This project is the front-end interface for a voice chat service. It provides an intuitive and responsive user interface to interact with the voice chat system, manage users, and participate in real-time communications. The application is built with modern front-end technologies, ensuring a smooth and interactive user experience.

## Available Scripts

The project includes several NPM scripts to simplify development, build, and management tasks. Below is a description of each script:

- `dev`:  
  Launches the development server using Vite, enabling hot-reload and fast feedback during development.  
  Command: `bun run dev`

- `build`:  
  Compiles and bundles the application for production, followed by publishing the compiled files using the `hive publish` command.  
  Command: `bun run build`

- `preview`:  
  Serves the production build locally for testing purposes.  
  Command: `bun run preview`

- `glue-proto:windows`:  
  Generates TypeScript definitions from the `transport.proto` file for a Windows environment.  
  Command: `bun run glue-proto:windows`

- `glue-proto:linux`:  
  Generates TypeScript definitions from the `transport.proto` file for a Linux environment.  
  Command: `bun run glue-proto:linux`

## Host Repository

The repository of the host application is private and not open to public access. For local development or modifications, it is recommended to use a standard host with path overrides for distribution.

## Host Arguments

The application supports the following host arguments for runtime configuration:

- `--console`¹: Allocates a console window. 
- `--no-priority-class`¹: Disables setting the process priority class to `RealTime`.
- `--no-priority-boost`¹: Enables process priority boosting.
- `--gpu-debug`: Opens the Chrome GPU debugging page.
- `--devtools`: Enables developer tools.
- `--host-use-localhost`²: Uses `https://localhost` with port 5005 for development.
- `--bypass-security`²: Allows the use of unsigned fragments.


*1 - console, and process priority with boost only for windows          
*2 - usable for development (used only for developing and/or fixing something.)    



# License    
    
GNU General Public License v2.0
