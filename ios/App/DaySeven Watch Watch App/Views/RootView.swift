import SwiftUI

// MARK: - Workout Controls Tab (shown as left page during active workout)

struct WorkoutControlsTab: View {
    @ObservedObject var workoutMgr: WorkoutManager

    var body: some View {
        VStack(spacing: 16) {
            Spacer()

            if workoutMgr.isPaused {
                Text("Paused")
                    .font(.system(size: 16, weight: .bold))
                    .foregroundColor(.yellow)
            }

            // Pause / Resume
            Button {
                if workoutMgr.isPaused { workoutMgr.resume() } else { workoutMgr.pause() }
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: workoutMgr.isPaused ? "play.fill" : "pause.fill")
                        .font(.system(size: 18))
                    Text(workoutMgr.isPaused ? "Resume" : "Pause")
                        .font(.system(size: 16, weight: .bold))
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 12)
                .background(Color.yellow)
                .foregroundColor(.black)
                .cornerRadius(14)
            }
            .buttonStyle(.plain)

            // End
            Button {
                Task {
                    do {
                        _ = try await workoutMgr.endWorkout()
                    } catch {
                        print("[WorkoutControlsTab] End workout error: \(error)")
                    }
                }
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: "xmark")
                        .font(.system(size: 16, weight: .bold))
                    Text("End")
                        .font(.system(size: 16, weight: .bold))
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 12)
                .background(Color.red)
                .foregroundColor(.white)
                .cornerRadius(14)
            }
            .buttonStyle(.plain)

            Spacer()
        }
        .padding(.horizontal, 8)
    }
}

// MARK: - Root View (Auth Gate)

struct RootView: View {
    @EnvironmentObject var appVM: AppViewModel

    var body: some View {
        Group {
            if appVM.authService.isLoading {
                ProgressView()
                    .tint(.green)
            } else if appVM.authService.isSignedIn {
                MainTabView()
            } else {
                SignInView()
            }
        }
        .onChange(of: appVM.authService.isSignedIn) { _, signedIn in
            if signedIn {
                Task {
                    await appVM.requestHealthKitPermissions()
                    await appVM.loadUserData()
                }
            }
        }
    }
}

// MARK: - Custom Page Dots

/// Custom dot indicator that shows the correct number of dots for each state.
/// - No workout: 2 dots (activity selector → dashboard)
/// - Active workout: 3 dots (controls → timer → dashboard)
/// - Summary: 0 dots (hidden)
private struct PageDotsOverlay: View {
    let totalDots: Int
    let selectedIndex: Int

    var body: some View {
        GeometryReader { geo in
            if totalDots > 0 {
                HStack(spacing: 4) {
                    ForEach(0..<totalDots, id: \.self) { index in
                        Circle()
                            .fill(index == selectedIndex ? Color.white : Color.white.opacity(0.3))
                            .frame(width: 6, height: 6)
                    }
                }
                .frame(maxWidth: .infinity)
                .position(x: geo.size.width / 2, y: geo.size.height - 6)
            }
        }
    }
}

// MARK: - Main Tab View

struct MainTabView: View {
    @EnvironmentObject var appVM: AppViewModel
    @Environment(\.scenePhase) private var scenePhase
    @State private var startPath = NavigationPath()
    @State private var selectedTab = 0  // Default to activity selector (leftmost tab)

    /// Whether a workout is currently running
    private var isWorkoutActive: Bool {
        appVM.workoutManager.isActive
    }

    /// Whether the summary is showing (workout ended, result published, user still on nav stack)
    private var isShowingSummary: Bool {
        appVM.workoutManager.lastResult != nil && !startPath.isEmpty
    }

    /// How many dots to show
    /// - No workout: 2 dots (activity selector → dashboard)
    /// - Active workout: 3 dots (controls → timer → dashboard)
    /// - Summary: 0 dots (hidden)
    private var dotCount: Int {
        if isShowingSummary { return 0 }
        if appVM.workoutManager.lastResult != nil { return 0 }
        if isWorkoutActive { return 3 }
        return 2
    }

    /// Map the current state to the correct highlighted dot index.
    private var dotIndex: Int {
        if isWorkoutActive {
            // 3-dot mode: controls(0) → timer(1) → dashboard(2)
            // When on outer tab 0 (timer/controls), use the nested page index
            // When on outer tab 1 (dashboard), dot index = 2
            if selectedTab == 1 { return 2 }
            return appVM.workoutManager.workoutPageIndex  // 0 = controls, 1 = timer
        }
        // 2-dot mode: activity(0) → dashboard(1)
        return min(selectedTab, 1)
    }

    var body: some View {
        // 2 static tabs: Activity/Timer (tag 0) → Dashboard (tag 1)
        // Both edges have natural watchOS bounce.
        // During active workout, ActiveWorkoutView contains its own nested
        // page TabView for Controls ← → Timer navigation.
        TabView(selection: $selectedTab) {
            // Tab 0 — Start Activity / Active Workout Timer
            NavigationStack(path: $startPath) {
                StartActivityView(path: $startPath)
            }
            .tag(0)

            // Tab 1 — Dashboard
            DashboardView()
                .tag(1)
        }
        .tabViewStyle(.page(indexDisplayMode: .never)) // Hide system dots, we draw our own
        .overlay {
            // Custom dots positioned at absolute bottom of screen
            PageDotsOverlay(totalDots: dotCount, selectedIndex: dotIndex)
                .allowsHitTesting(false)
        }
        .overlay {
            ZStack {
                // Workout summary overlay — rendered ABOVE the entire TabView so
                // horizontal swipe gestures can't reach the pager underneath.
                if isShowingSummary, let result = appVM.workoutManager.lastResult {
                    WorkoutSummaryView(
                        result: result,
                        activityType: appVM.workoutManager.summaryActivityType,
                        strengthType: appVM.workoutManager.summaryStrengthType,
                        initialSubtype: appVM.workoutManager.summarySubtype,
                        initialFocusArea: appVM.workoutManager.summaryFocusArea,
                        initialCountToward: appVM.workoutManager.summaryCountToward,
                        workoutMgr: appVM.workoutManager,
                        onDone: {
                            appVM.phoneService.notifyPhoneWorkoutEnded()
                            appVM.workoutManager.isDismissingSummary = true
                            startPath = NavigationPath()
                        }
                    )
                    .background(Color.black)
                    .transition(.opacity)
                }

                // Celebration overlay (on top of everything)
                if appVM.celebrationManager.activeCelebration != nil {
                    CelebrationOverlayView(celebration: appVM.celebrationManager.activeCelebration!)
                        .transition(.opacity)
                }
            }
        }
        .ignoresSafeArea(edges: .bottom)
        .task {
            if appVM.activities.isEmpty {
                await appVM.loadUserData()
            }
        }
        // When workout starts, jump to timer (tab 0)
        .onChange(of: appVM.workoutManager.isActive) { oldActive, active in
            if active && !oldActive {
                // Workout just started — go to timer page (tab 0)
                // and ensure nested pager shows timer, not controls
                selectedTab = 0
                appVM.workoutManager.workoutPageIndex = 1
            } else if !active && oldActive {
                // Workout just ended — stay on tab 0 (summary shows there)
                selectedTab = 0
            }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active {
                appVM.phoneService.ensureSessionActive()

                // Refresh health data to catch daily goals hit while backgrounded
                Task { await appVM.refreshHealthData() }

                // If a workout is active but no ActiveWorkoutView is shown,
                // push one — but only after a short delay to let the
                // remoteWorkoutRequest onChange handler fire first (it has priority).
                if appVM.workoutManager.isActive && startPath.isEmpty {
                    selectedTab = 0
                    appVM.workoutManager.workoutPageIndex = 1  // Ensure timer page, not controls
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                        // Re-check: if remoteWorkoutRequest handler already navigated, skip
                        guard startPath.isEmpty && appVM.workoutManager.isActive else { return }
                        if let request = appVM.phoneService.remoteWorkoutRequest {
                            if request.subtype != nil || request.focusArea != nil {
                                startPath.append(WorkoutDestination.customStart(
                                    activityType: request.activityType,
                                    strengthType: request.strengthType,
                                    subtype: request.subtype,
                                    focusArea: request.focusArea
                                ))
                            } else {
                                startPath.append(WorkoutDestination.quickStart(
                                    activityType: request.activityType,
                                    strengthType: request.strengthType
                                ))
                            }
                        } else {
                            startPath.append(WorkoutDestination.quickStart(
                                activityType: "Other",
                                strengthType: nil
                            ))
                        }
                    }
                } else if !startPath.isEmpty {
                    selectedTab = 0
                }
            }
        }
        .onChange(of: appVM.phoneService.remoteWorkoutRequest) { _, request in
            if let request = request {
                selectedTab = 0
                // Only navigate if we haven't already pushed an ActiveWorkoutView
                guard startPath.isEmpty else {
                    print("[MainTabView] remoteWorkoutRequest: startPath not empty, skipping nav")
                    return
                }
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                    // Re-check in case scenePhase handler navigated during the delay
                    guard startPath.isEmpty else { return }
                    if request.subtype != nil || request.focusArea != nil {
                        startPath.append(WorkoutDestination.customStart(
                            activityType: request.activityType,
                            strengthType: request.strengthType,
                            subtype: request.subtype,
                            focusArea: request.focusArea
                        ))
                    } else {
                        startPath.append(WorkoutDestination.quickStart(
                            activityType: request.activityType,
                            strengthType: request.strengthType
                        ))
                    }
                }
            }
        }
        .onChange(of: appVM.phoneService.remoteWorkoutEnded) { _, ended in
            if ended {
                startPath = NavigationPath()
                appVM.workoutManager.lastResult = nil
                appVM.phoneService.remoteWorkoutRequest = nil
                selectedTab = 0
                appVM.phoneService.remoteWorkoutEnded = false
            }
        }
        // Lock tab during summary so user can't swipe away
        .onChange(of: selectedTab) { _, newTab in
            if isShowingSummary && newTab != 0 {
                selectedTab = 0
            }
        }
        // When user finishes summary and navigates back, clear lastResult
        .onChange(of: startPath) { _, newPath in
            if newPath.isEmpty && appVM.workoutManager.lastResult != nil && !appVM.workoutManager.isActive {
                appVM.workoutManager.lastResult = nil
                appVM.phoneService.remoteWorkoutRequest = nil
                appVM.workoutManager.isDismissingSummary = false
                selectedTab = 0  // Back to activity selector
            }
        }
    }
}
