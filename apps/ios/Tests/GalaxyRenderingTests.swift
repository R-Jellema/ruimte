import Metal
import XCTest

@testable import Ruimte

final class GalaxyRenderingTests: XCTestCase {
    func testBothPalettesRenderWithoutDarkHalos() throws {
        for dark in [false, true] {
            let pixels = try render(time: 12, dark: dark)
            let stars = pixels.filter { $0.w > 0.01 }
            XCTAssertGreaterThan(stars.count, 20)
            for pixel in stars {
                XCTAssertEqual(max(pixel.x, pixel.y, pixel.z), pixel.w, accuracy: 0.002)
                XCTAssertGreaterThanOrEqual(pixel.w, 0)
                XCTAssertLessThanOrEqual(pixel.w, 1)
            }
            let warm = stars.filter { $0.x > $0.z + 0.002 }
            if dark {
                XCTAssertTrue(warm.isEmpty)
            } else {
                XCTAssertFalse(warm.isEmpty)
            }
        }
    }

    func testAnimationChangesTheStarfield() throws {
        XCTAssertNotEqual(try render(time: 12, dark: true), try render(time: 13, dark: true))
    }

    func testTouchRepulsionAndWarpChangeTheStarfield() throws {
        let baseline = try render(time: 12, dark: true)
        XCTAssertNotEqual(baseline, try render(time: 12, dark: true, interaction: SIMD4(160, 200, 1, 0)))
        XCTAssertNotEqual(baseline, try render(time: 12, dark: true, interaction: SIMD4(160, 200, 0, 1)))
    }

    private func render(time: Float, dark: Bool, interaction: SIMD4<Float> = SIMD4(160, 200, 0, 0)) throws -> [SIMD4<
        Float
    >] {
        let device = try XCTUnwrap(MTLCreateSystemDefaultDevice())
        let library = try device.makeDefaultLibrary(bundle: Bundle(for: Self.self))
        let function = try XCTUnwrap(library.makeFunction(name: "sampleGalaxy"))
        let shader = try XCTUnwrap(library.makeFunction(name: "galaxy"))
        let linked = MTLLinkedFunctions()
        linked.functions = [shader]
        let descriptor = MTLComputePipelineDescriptor()
        descriptor.computeFunction = function
        descriptor.linkedFunctions = linked
        let pipeline = try device.makeComputePipelineState(descriptor: descriptor, options: [], reflection: nil)
        let queue = try XCTUnwrap(device.makeCommandQueue())
        let command = try XCTUnwrap(queue.makeCommandBuffer())
        let pixels = try XCTUnwrap(device.makeBuffer(length: 1024 * MemoryLayout<SIMD4<Float>>.stride))
        let encoder = try XCTUnwrap(command.makeComputeCommandEncoder())
        var settings = SIMD4<Float>(time, dark ? 1 : 0, 1, 1)
        encoder.setComputePipelineState(pipeline)
        encoder.setBuffer(pixels, offset: 0, index: 0)
        encoder.setBytes(&settings, length: MemoryLayout<SIMD4<Float>>.stride, index: 1)
        var touch = interaction
        var travel: Float = 0
        encoder.setBytes(&touch, length: MemoryLayout<SIMD4<Float>>.stride, index: 2)
        encoder.setBytes(&travel, length: MemoryLayout<Float>.stride, index: 3)
        encoder.dispatchThreads(
            MTLSize(width: 1024, height: 1, depth: 1),
            threadsPerThreadgroup: MTLSize(width: pipeline.threadExecutionWidth, height: 1, depth: 1))
        encoder.endEncoding()
        command.commit()
        command.waitUntilCompleted()
        if let error = command.error { throw error }
        let pointer = pixels.contents().bindMemory(to: SIMD4<Float>.self, capacity: 1024)
        return Array(UnsafeBufferPointer(start: pointer, count: 1024))
    }
}
